import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { razorpay } from "../src/lib/razorpay.js";
import { closeQueue, getQueue } from "../src/modules/notifications/notifications.queue.js";
import { settleDeposit } from "../src/modules/payments/payments.refunds.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";
import { addStaff, atISO, setupSalon, type Salon } from "./helpers/salon.js";

const app = createApp();
let counter = 0;

beforeEach(async () => {
  await resetDb();
  await getQueue().obliterate({ force: true });
  vi.restoreAllMocks();
  vi.spyOn(razorpay, "createOrder").mockImplementation(async ({ amountCents }) => ({ id: `order_ow_${++counter}`, amount: amountCents, currency: "INR", status: "created" }));
});

afterAll(async () => {
  await closeQueue();
});

const payments = (salon: Salon, auth = salon.auth) => request(app).get(`/businesses/${salon.businessId}/payments`).set(auth);
const setDeposit = (salon: Salon, body: object) => request(app).patch(`/businesses/${salon.businessId}`).set(salon.auth).send(body);

/** Books the ₹300 Haircut at the given time; with deposits on, pays the deposit too. */
async function bookAndPay(salon: Salon, staffId: string, clock: string) {
  const customer = await createOwner(app);
  const { body } = await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, staffId, startsAt: atISO(clock) });
  const paymentId = `pay_ow_${++counter}`;
  const razorpaySignature = createHmac("sha256", "test-only-razorpay-secret").update(`${body.payment.orderId}|${paymentId}`).digest("hex");
  await request(app).post(`/me/bookings/${body.booking.id}/pay`).set(customer.auth).send({ razorpayOrderId: body.payment.orderId, razorpayPaymentId: paymentId, razorpaySignature }).expect(200);
  return body.booking.id as string;
}

describe("GET /businesses/:id/payments", () => {
  it("starts empty, with the default settings", async () => {
    const salon = await setupSalon(app);

    const res = await payments(salon);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settings: { depositPercent: null, freeCancelHours: 24, paymentsAvailable: true, commissionPercent: 10 },
      totals: { deposit: 0, commission: 0, refund: 0, payout: 0 },
      balanceCents: 0,
      entries: [],
    });
  });

  it("shows the salon's ledger, newest first, with the booking each row is about", async () => {
    const salon = await setupSalon(app);
    await setDeposit(salon, { depositPercent: 20 }).expect(200);
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    const bookingId = await bookAndPay(salon, priya, "09:30");
    await settleDeposit(bookingId, { kind: "no_show" }); // the salon keeps it

    const res = await payments(salon);

    expect(res.body.totals).toEqual({ deposit: 6000, commission: -600, refund: 0, payout: 0 });
    expect(res.body.balanceCents).toBe(5400);
    expect(res.body.entries).toEqual([
      expect.objectContaining({ type: "commission", amountCents: -600, booking: expect.objectContaining({ id: bookingId, service: { name: "Haircut" } }) }),
      expect.objectContaining({ type: "deposit", amountCents: 6000, booking: expect.objectContaining({ id: bookingId, customer: { name: expect.any(String) } }) }),
    ]);
  });

  it("shows a payout with its bank reference", async () => {
    const salon = await setupSalon(app);
    await setDeposit(salon, { depositPercent: 20 }).expect(200);
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    await settleDeposit(await bookAndPay(salon, priya, "09:30"), { kind: "completed" });
    // Payouts are recorded by SlotBook's admin; here straight in the database.
    const owner = await prisma.business.findUniqueOrThrow({ where: { id: salon.businessId }, select: { ownerId: true } });
    const payout = await prisma.payout.create({ data: { businessId: salon.businessId, amountCents: 5400, reference: "UTR42", recordedById: owner.ownerId } });
    await prisma.ledgerEntry.create({ data: { businessId: salon.businessId, type: "payout", amountCents: -5400, payoutId: payout.id } });

    const res = await payments(salon);

    expect(res.body.balanceCents).toBe(0);
    expect(res.body.entries[0]).toMatchObject({ type: "payout", amountCents: -5400, payoutReference: "UTR42", booking: null });
  });

  it("is 404 for someone else's salon, and 401 without a login", async () => {
    const salon = await setupSalon(app);
    const stranger = await createOwner(app);

    expect((await payments(salon, stranger.auth)).status).toBe(404);
    expect((await request(app).get(`/businesses/${salon.businessId}/payments`)).status).toBe(401);
  });
});

describe("deposit settings (PATCH /businesses/:id)", () => {
  it("can be turned on, changed and off again", async () => {
    const salon = await setupSalon(app);

    await setDeposit(salon, { depositPercent: 25, freeCancelHours: 48 }).expect(200);
    expect((await payments(salon)).body.settings).toMatchObject({ depositPercent: 25, freeCancelHours: 48 });

    await setDeposit(salon, { depositPercent: null }).expect(200);
    expect((await payments(salon)).body.settings.depositPercent).toBeNull();
  });

  it("refuses values outside the allowed ranges", async () => {
    const salon = await setupSalon(app);

    for (const body of [{ depositPercent: 0 }, { depositPercent: 101 }, { depositPercent: 12.5 }, { freeCancelHours: -1 }, { freeCancelHours: 721 }]) {
      expect((await setDeposit(salon, body)).status).toBe(400);
    }
  });

  it("a new percentage only applies to new bookings", async () => {
    const salon = await setupSalon(app);
    await setDeposit(salon, { depositPercent: 20 }).expect(200);
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    const first = await bookAndPay(salon, priya, "09:30");

    await setDeposit(salon, { depositPercent: 50 }).expect(200);

    expect((await prisma.payment.findUniqueOrThrow({ where: { bookingId: first } })).amountCents).toBe(6000); // still 20%
  });
});
