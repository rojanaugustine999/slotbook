import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { razorpay } from "../src/lib/razorpay.js";
import { closeQueue, getQueue } from "../src/modules/notifications/notifications.queue.js";
import { depositFor, processHoldRelease } from "../src/modules/payments/payments.service.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";
import { addStaff, atISO, date, setupSalon, type Salon } from "./helpers/salon.js";

const app = createApp();
let orderCount = 0;

beforeEach(async () => {
  await resetDb();
  await getQueue().obliterate({ force: true });
  vi.restoreAllMocks();
  // A fake Razorpay: every order gets a fresh id, and nothing leaves this machine.
  vi.spyOn(razorpay, "createOrder").mockImplementation(async ({ amountCents }) => ({
    id: `order_test_${++orderCount}`,
    amount: amountCents,
    currency: "INR",
    status: "created",
  }));
});

afterAll(async () => {
  await closeQueue();
});

// What Razorpay would send the browser: the signature is HMAC-SHA256 of "order|payment"
// with the key secret. vitest.config.ts sets the same fake secret for the server.
function razorpayResult(orderId: string, paymentId = `pay_test_${++orderCount}`) {
  const razorpaySignature = createHmac("sha256", "test-only-razorpay-secret").update(`${orderId}|${paymentId}`).digest("hex");
  return { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature };
}

/** A salon taking a 20% deposit, with Priya free 09:00 to 11:00. The Haircut's price comes from the factory. */
async function depositSalon(percent = 20) {
  const salon = await setupSalon(app);
  await prisma.business.update({ where: { id: salon.businessId }, data: { depositPercent: percent } });
  const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
  return { salon, priya };
}

async function book(salon: Salon, staffId: string, clock = "09:30") {
  const customer = await createOwner(app);
  const res = await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, staffId, startsAt: atISO(clock) });
  return { customer, res };
}

const pay = (auth: Record<string, string>, bookingId: string, body: object) => request(app).post(`/me/bookings/${bookingId}/pay`).set(auth).send(body);

const slotTimes = async (salon: Salon) =>
  (await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date })).body.slots.map((s: { time: string }) => s.time);

describe("depositFor", () => {
  it("takes the percentage, rounded to whole paise", () => {
    expect(depositFor(50_000, 20)).toBe(10_000);
    expect(depositFor(33_333, 10)).toBe(3_333);
  });

  it("is never under ₹1 and never more than the price", () => {
    expect(depositFor(500, 1)).toBe(100); // 5 paise would be too small for Razorpay
    expect(depositFor(150, 100)).toBe(150);
  });

  it("is off without a percentage or for services under ₹1", () => {
    expect(depositFor(50_000, null)).toBeNull();
    expect(depositFor(99, 50)).toBeNull();
  });
});

describe("booking with a deposit", () => {
  it("holds the slot and returns what Checkout needs", async () => {
    const { salon, priya } = await depositSalon();
    const { res } = await book(salon, priya);

    expect(res.status).toBe(201);
    const price = res.body.booking.priceCents;
    expect(res.body.booking).toMatchObject({ status: "pending", payment: { amountCents: depositFor(price, 20), status: "created" } });
    expect(new Date(res.body.booking.holdExpiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(res.body.payment).toEqual({ orderId: expect.stringMatching(/^order_test_/), amountCents: depositFor(price, 20), currency: "INR", keyId: "rzp_test_fake_for_tests" });

    // The order was asked for the deposit, not the full price.
    expect(razorpay.createOrder).toHaveBeenCalledWith(expect.objectContaining({ amountCents: depositFor(price, 20) }));
    // Held means taken: nobody else is offered 09:30.
    expect(await slotTimes(salon)).not.toContain("09:30");
  });

  it("books straight away when the salon takes no deposit", async () => {
    const salon = await setupSalon(app);
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    const { res } = await book(salon, priya);

    expect(res.body.booking.status).toBe("confirmed");
    expect(res.body.payment).toBeNull();
    expect(razorpay.createOrder).not.toHaveBeenCalled();
  });

  it("releases the hold and answers 503 when Razorpay is down", async () => {
    const { salon, priya } = await depositSalon();
    vi.mocked(razorpay.createOrder).mockRejectedValueOnce(new Error("network down"));

    const { res } = await book(salon, priya);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("PAYMENTS_UNAVAILABLE");
    expect(await slotTimes(salon)).toContain("09:30"); // the slot is free again
  });
});

describe("POST /me/bookings/:id/pay", () => {
  it("confirms the booking and writes the deposit to the ledger", async () => {
    const { salon, priya } = await depositSalon();
    const { customer, res } = await book(salon, priya);
    const { booking, payment } = res.body;

    const paid = await pay(customer.auth, booking.id, razorpayResult(payment.orderId, "pay_abc"));

    expect(paid.status).toBe(200);
    expect(paid.body.booking).toMatchObject({ status: "confirmed", holdExpiresAt: null });
    const row = await prisma.payment.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(row).toMatchObject({ status: "paid", providerPaymentId: "pay_abc" });
    const ledger = await prisma.ledgerEntry.findMany({ where: { businessId: salon.businessId } });
    expect(ledger).toEqual([expect.objectContaining({ type: "deposit", amountCents: payment.amountCents, paymentId: row.id })]);
  });

  it("refuses a made-up signature", async () => {
    const { salon, priya } = await depositSalon();
    const { customer, res } = await book(salon, priya);

    const paid = await pay(customer.auth, res.body.booking.id, { ...razorpayResult(res.body.payment.orderId), razorpaySignature: "0".repeat(64) });

    expect(paid.status).toBe(400);
    expect(paid.body.error.code).toBe("INVALID_SIGNATURE");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: res.body.booking.id } })).status).toBe("pending");
  });

  it("refuses a real signature for a different order", async () => {
    const { salon, priya } = await depositSalon();
    const { customer, res } = await book(salon, priya);

    // Validly signed, but for an order that isn't this booking's (say, a cheaper one).
    const paid = await pay(customer.auth, res.body.booking.id, razorpayResult("order_someone_elses"));

    expect(paid.status).toBe(400);
  });

  it("is safe to call twice: one ledger row, same answer", async () => {
    const { salon, priya } = await depositSalon();
    const { customer, res } = await book(salon, priya);
    const body = razorpayResult(res.body.payment.orderId);

    const [first, second] = await Promise.all([pay(customer.auth, res.body.booking.id, body), pay(customer.auth, res.body.booking.id, body)]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });

  it("is 404 for someone else's booking", async () => {
    const { salon, priya } = await depositSalon();
    const { res } = await book(salon, priya);
    const stranger = await createOwner(app);

    const paid = await pay(stranger.auth, res.body.booking.id, razorpayResult(res.body.payment.orderId));

    expect(paid.status).toBe(404);
  });

  it("still confirms a late payment if nobody took the slot", async () => {
    const { salon, priya } = await depositSalon();
    const { customer, res } = await book(salon, priya);
    await prisma.booking.update({ where: { id: res.body.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });

    const paid = await pay(customer.auth, res.body.booking.id, razorpayResult(res.body.payment.orderId));

    expect(paid.body.booking.status).toBe("confirmed");
  });

  it("answers HOLD_EXPIRED when the hold was already released, but keeps the money on record", async () => {
    const { salon, priya } = await depositSalon();
    const { customer, res } = await book(salon, priya);
    await prisma.booking.update({ where: { id: res.body.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
    await processHoldRelease(res.body.booking.id); // what the queue job does

    const paid = await pay(customer.auth, res.body.booking.id, razorpayResult(res.body.payment.orderId));

    expect(paid.status).toBe(409);
    expect(paid.body.error.code).toBe("HOLD_EXPIRED");
    // The money did arrive, so it's recorded (part 4 refunds it).
    expect((await prisma.payment.findUniqueOrThrow({ where: { bookingId: res.body.booking.id } })).status).toBe("paid");
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });
});

describe("GET /me/bookings/:id/payment (paying later)", () => {
  const openDeposit = (auth: Record<string, string>, bookingId: string) => request(app).get(`/me/bookings/${bookingId}/payment`).set(auth);

  it("returns the same order while the hold is running", async () => {
    const { salon, priya } = await depositSalon();
    const { customer, res } = await book(salon, priya);

    const again = await openDeposit(customer.auth, res.body.booking.id);

    expect(again.status).toBe(200);
    expect(again.body.payment).toEqual(res.body.payment); // no second Razorpay order
    expect(razorpay.createOrder).toHaveBeenCalledTimes(1);
  });

  it("refuses once paid, or once the hold has run out", async () => {
    const { salon, priya } = await depositSalon();
    const paid = await book(salon, priya, "09:00");
    await pay(paid.customer.auth, paid.res.body.booking.id, razorpayResult(paid.res.body.payment.orderId));
    const late = await book(salon, priya, "10:00");
    await prisma.booking.update({ where: { id: late.res.body.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

    expect((await openDeposit(paid.customer.auth, paid.res.body.booking.id)).body.error.code).toBe("NOT_AWAITING_PAYMENT");
    expect((await openDeposit(late.customer.auth, late.res.body.booking.id)).body.error.code).toBe("NOT_AWAITING_PAYMENT");
  });

  it("is 404 for someone else's booking", async () => {
    const { salon, priya } = await depositSalon();
    const { res } = await book(salon, priya);
    const stranger = await createOwner(app);

    expect((await openDeposit(stranger.auth, res.body.booking.id)).status).toBe(404);
  });
});

describe("expired holds", () => {
  const expire = (bookingId: string) => prisma.booking.update({ where: { id: bookingId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

  it("free the slot in availability right away", async () => {
    const { salon, priya } = await depositSalon();
    const { res } = await book(salon, priya);
    await expire(res.body.booking.id);

    expect(await slotTimes(salon)).toContain("09:30");
  });

  it("are released when the next customer books that slot", async () => {
    const { salon, priya } = await depositSalon();
    const first = await book(salon, priya);
    await expire(first.res.body.booking.id);

    const second = await book(salon, priya);

    expect(second.res.status).toBe(201);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: first.res.body.booking.id } })).toMatchObject({ status: "cancelled" });
    expect(await prisma.payment.findUniqueOrThrow({ where: { bookingId: first.res.body.booking.id } })).toMatchObject({ status: "failed" });
  });

  it("are not released while still running", async () => {
    const { salon, priya } = await depositSalon();
    const { res } = await book(salon, priya);

    expect(await processHoldRelease(res.body.booking.id)).toBe(0);
    expect((await book(salon, priya)).res.status).toBe(409); // still taken
  });

  it("get a queued release job", async () => {
    const { salon, priya } = await depositSalon();
    const { res } = await book(salon, priya);

    const job = await getQueue().getJob(`hold-${res.body.booking.id}`);
    expect(job?.name).toBe("release-hold");
    expect(await job?.getState()).toBe("delayed");
  });
});

describe("other changes to a held booking", () => {
  it("cancelling it marks the payment failed", async () => {
    const { salon, priya } = await depositSalon();
    const { customer, res } = await book(salon, priya);

    await request(app).post(`/me/bookings/${res.body.booking.id}/cancel`).set(customer.auth).expect(200);

    expect((await prisma.payment.findUniqueOrThrow({ where: { bookingId: res.body.booking.id } })).status).toBe("failed");
    expect(await getQueue().getJob(`hold-${res.body.booking.id}`)).toBeUndefined();
  });

  it("the owner can never confirm it by hand (only a verified payment can)", async () => {
    const { salon, priya } = await depositSalon();
    const { res } = await book(salon, priya);

    const changed = await request(app)
      .patch(`/businesses/${salon.businessId}/bookings/${res.body.booking.id}/status`)
      .set(salon.auth)
      .send({ status: "confirmed" });

    expect(changed.status).toBe(400);
  });

  it("can't be rescheduled before paying", async () => {
    const { salon, priya } = await depositSalon();
    const { customer, res } = await book(salon, priya);

    const moved = await request(app).post(`/me/bookings/${res.body.booking.id}/reschedule`).set(customer.auth).send({ startsAt: atISO("10:00") });

    expect(moved.status).toBe(409);
  });
});
