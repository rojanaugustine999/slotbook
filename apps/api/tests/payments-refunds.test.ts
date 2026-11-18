import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { razorpay } from "../src/lib/razorpay.js";
import { closeQueue, getQueue } from "../src/modules/notifications/notifications.queue.js";
import { processRefund, settleDeposit } from "../src/modules/payments/payments.refunds.js";
import { commissionFor, depositOutcome } from "../src/modules/payments/payments.rules.js";
import { processHoldRelease } from "../src/modules/payments/payments.service.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";
import { addStaff, atISO, setupSalon } from "./helpers/salon.js";

const app = createApp();
let counter = 0;

beforeEach(async () => {
  await resetDb();
  await prisma.webhookEvent.deleteMany();
  await getQueue().obliterate({ force: true });
  vi.restoreAllMocks();
  // A fake Razorpay: orders, refunds and the refund list never leave this machine.
  vi.spyOn(razorpay, "createOrder").mockImplementation(async ({ amountCents }) => ({ id: `order_rf_${++counter}`, amount: amountCents, currency: "INR", status: "created" }));
  vi.spyOn(razorpay, "refundPayment").mockImplementation(async (_paymentId, { amountCents, notes }) => ({ id: `rfnd_${++counter}`, amount: amountCents, status: "processed", notes }));
  vi.spyOn(razorpay, "listRefunds").mockResolvedValue([]);
});

afterAll(async () => {
  await closeQueue();
});

/** A salon with a 20% deposit and a booking a week ahead whose deposit is paid. */
async function paidBooking(options: { freeCancelHours?: number } = {}) {
  const salon = await setupSalon(app);
  await prisma.business.update({ where: { id: salon.businessId }, data: { depositPercent: 20, freeCancelHours: options.freeCancelHours ?? 24 } });
  const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
  const customer = await createOwner(app);
  const res = await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, staffId: priya, startsAt: atISO("09:30") });
  const { booking, payment } = res.body;
  const paymentId = `pay_rf_${++counter}`;
  const razorpaySignature = createHmac("sha256", "test-only-razorpay-secret").update(`${payment.orderId}|${paymentId}`).digest("hex");
  await request(app).post(`/me/bookings/${booking.id}/pay`).set(customer.auth).send({ razorpayOrderId: payment.orderId, razorpayPaymentId: paymentId, razorpaySignature }).expect(200);
  return { salon, customer, bookingId: booking.id as string, deposit: payment.amountCents as number, paymentId };
}

const ledger = async () => (await prisma.ledgerEntry.findMany({ orderBy: { createdAt: "asc" } })).map((e) => ({ type: e.type, amountCents: e.amountCents }));
const paymentOf = (bookingId: string) => prisma.payment.findUniqueOrThrow({ where: { bookingId } });
const refundOf = async (bookingId: string) => prisma.refund.findFirstOrThrow({ where: { payment: { bookingId } } });

describe("depositOutcome (the policy)", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  const hoursLater = (h: number) => new Date(now.getTime() + h * 3_600_000);

  it("refunds a customer who cancels at least freeCancelHours ahead (the limit itself counts)", () => {
    expect(depositOutcome({ kind: "customer_cancelled", startsAt: hoursLater(48), now, freeCancelHours: 24 })).toBe("refund");
    expect(depositOutcome({ kind: "customer_cancelled", startsAt: hoursLater(24), now, freeCancelHours: 24 })).toBe("refund");
  });

  it("keeps the deposit when the customer cancels later than that", () => {
    expect(depositOutcome({ kind: "customer_cancelled", startsAt: hoursLater(23.9), now, freeCancelHours: 24 })).toBe("keep");
  });

  it("with freeCancelHours 0, any cancel before the start is refunded", () => {
    expect(depositOutcome({ kind: "customer_cancelled", startsAt: hoursLater(0.1), now, freeCancelHours: 0 })).toBe("refund");
  });

  it("refunds when the salon cancels or the hold ran out; keeps it after completed or no-show", () => {
    expect(depositOutcome({ kind: "salon_cancelled" })).toBe("refund");
    expect(depositOutcome({ kind: "hold_expired" })).toBe("refund");
    expect(depositOutcome({ kind: "completed" })).toBe("keep");
    expect(depositOutcome({ kind: "no_show" })).toBe("keep");
  });

  it("commission is 10%, in whole paise", () => {
    expect(commissionFor(24_000)).toBe(2_400);
    expect(commissionFor(105)).toBe(11); // 10.5 rounds up
  });
});

describe("customer cancels a paid booking", () => {
  it("in time: the payment is refunded, the ledger nets to zero and a refund job is queued", async () => {
    const { customer, bookingId, deposit } = await paidBooking();

    const res = await request(app).post(`/me/bookings/${bookingId}/cancel`).set(customer.auth);

    expect(res.status).toBe(200);
    expect(res.body.booking.payment.status).toBe("refunded");
    expect(await ledger()).toEqual([{ type: "deposit", amountCents: deposit }, { type: "refund", amountCents: -deposit }]);
    const refund = await refundOf(bookingId);
    expect(refund).toMatchObject({ status: "pending", amountCents: deposit, reason: "customer_cancelled" });
    expect(await getQueue().getJob(`refund-${refund.id}`)).toBeDefined();
  });

  it("too late: the salon keeps the deposit and SlotBook's 10% commission is recorded", async () => {
    // The booking is a week (168 hours) ahead, so a 200-hour rule makes this cancel "late".
    const { customer, bookingId, deposit } = await paidBooking({ freeCancelHours: 200 });

    await request(app).post(`/me/bookings/${bookingId}/cancel`).set(customer.auth).expect(200);

    expect((await paymentOf(bookingId)).status).toBe("paid");
    expect(await ledger()).toEqual([{ type: "deposit", amountCents: deposit }, { type: "commission", amountCents: -commissionFor(deposit) }]);
    expect(await prisma.refund.count()).toBe(0);
  });
});

describe("owner changes a paid booking", () => {
  it("the salon cancelling always refunds", async () => {
    const { salon, bookingId } = await paidBooking({ freeCancelHours: 200 }); // even inside the customer's window

    const res = await request(app).patch(`/businesses/${salon.businessId}/bookings/${bookingId}/status`).set(salon.auth).send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.booking.payment.status).toBe("refunded");
    expect((await refundOf(bookingId)).reason).toBe("salon_cancelled");
  });

  it("completed and no-show keep the deposit, with the commission recorded only once", async () => {
    const { bookingId, deposit } = await paidBooking();

    // (Marking completed through the API needs a booking that has started, so call the rule directly.)
    expect(await settleDeposit(bookingId, { kind: "completed" })).toBe("keep");
    expect(await settleDeposit(bookingId, { kind: "completed" })).toBe("keep");

    expect(await ledger()).toEqual([{ type: "deposit", amountCents: deposit }, { type: "commission", amountCents: -commissionFor(deposit) }]);
  });
});

describe("a refund happens once, however it's triggered", () => {
  it("two settles at the same moment create one refund", async () => {
    const { bookingId } = await paidBooking();

    const outcomes = await Promise.all([settleDeposit(bookingId, { kind: "salon_cancelled" }), settleDeposit(bookingId, { kind: "salon_cancelled" })]);

    expect(outcomes.sort()).toEqual(["refund", null].sort());
    expect(await prisma.refund.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: "refund" } })).toBe(1);
  });

  it("the database refuses a second deposit row for the same payment", async () => {
    const { bookingId, deposit } = await paidBooking();
    const payment = await paymentOf(bookingId);

    await expect(
      prisma.ledgerEntry.create({ data: { businessId: payment.businessId, type: "deposit", amountCents: deposit, paymentId: payment.id } }),
    ).rejects.toThrow(/Unique constraint/);
  });
});

describe("processRefund (the queue job that calls Razorpay)", () => {
  it("sends the refund with our id in the notes and saves Razorpay's answer", async () => {
    const { bookingId, deposit, paymentId } = await paidBooking();
    await settleDeposit(bookingId, { kind: "salon_cancelled" });
    const refund = await refundOf(bookingId);

    await processRefund(refund.id);

    expect(razorpay.refundPayment).toHaveBeenCalledWith(paymentId, { amountCents: deposit, notes: { refundId: refund.id } });
    expect(await refundOf(bookingId)).toMatchObject({ status: "processed", providerRefundId: expect.stringMatching(/^rfnd_/) });
  });

  it("doesn't refund again when an earlier try reached Razorpay but failed to save", async () => {
    const { bookingId, deposit } = await paidBooking();
    await settleDeposit(bookingId, { kind: "salon_cancelled" });
    const refund = await refundOf(bookingId);
    // Razorpay already has a refund carrying our id (the first try got that far).
    vi.mocked(razorpay.listRefunds).mockResolvedValue([{ id: "rfnd_earlier", amount: deposit, status: "processed", notes: { refundId: refund.id } }]);

    await processRefund(refund.id);

    expect(razorpay.refundPayment).not.toHaveBeenCalled();
    expect((await refundOf(bookingId)).providerRefundId).toBe("rfnd_earlier");
  });

  it("does nothing the second time", async () => {
    const { bookingId } = await paidBooking();
    await settleDeposit(bookingId, { kind: "salon_cancelled" });
    const refund = await refundOf(bookingId);

    await processRefund(refund.id);
    await processRefund(refund.id);

    expect(razorpay.refundPayment).toHaveBeenCalledTimes(1);
  });

  it("throws when Razorpay is down, so the queue tries again later", async () => {
    const { bookingId } = await paidBooking();
    await settleDeposit(bookingId, { kind: "salon_cancelled" });
    const refund = await refundOf(bookingId);
    vi.mocked(razorpay.refundPayment).mockRejectedValueOnce(new Error("Razorpay answered 502"));

    await expect(processRefund(refund.id)).rejects.toThrow("502");
    expect((await refundOf(bookingId)).status).toBe("pending");

    await processRefund(refund.id); // the retry
    expect((await refundOf(bookingId)).status).toBe("processed");
  });
});

describe("late payments and refund webhooks", () => {
  it("a payment arriving after its hold was released is refunded automatically", async () => {
    const salon = await setupSalon(app);
    await prisma.business.update({ where: { id: salon.businessId }, data: { depositPercent: 20 } });
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createOwner(app);
    const { body } = await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, staffId: priya, startsAt: atISO("09:30") });
    await prisma.booking.update({ where: { id: body.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await processHoldRelease(body.booking.id);

    const razorpaySignature = createHmac("sha256", "test-only-razorpay-secret").update(`${body.payment.orderId}|pay_late`).digest("hex");
    const res = await request(app)
      .post(`/me/bookings/${body.booking.id}/pay`)
      .set(customer.auth)
      .send({ razorpayOrderId: body.payment.orderId, razorpayPaymentId: "pay_late", razorpaySignature });

    expect(res.body.error.code).toBe("HOLD_EXPIRED");
    expect((await paymentOf(body.booking.id)).status).toBe("refunded");
    expect((await refundOf(body.booking.id)).reason).toBe("hold_expired");
  });

  it("refund.processed from Razorpay finishes a pending refund (found by our id in the notes)", async () => {
    const { bookingId } = await paidBooking();
    await settleDeposit(bookingId, { kind: "salon_cancelled" });
    const refund = await refundOf(bookingId);
    const body = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_from_webhook", status: "processed", notes: { refundId: refund.id } } } } });
    const signature = createHmac("sha256", "test-only-webhook-secret").update(body).digest("hex");

    const res = await request(app).post("/webhooks/razorpay").set("Content-Type", "application/json").set("X-Razorpay-Signature", signature).send(body);

    expect(res.body.outcome).toBe("recorded");
    expect(await refundOf(bookingId)).toMatchObject({ status: "processed", providerRefundId: "rfnd_from_webhook" });
  });
});
