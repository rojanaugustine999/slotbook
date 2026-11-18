import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { razorpay } from "../src/lib/razorpay.js";
import { closeQueue, getQueue } from "../src/modules/notifications/notifications.queue.js";
import { processHoldRelease } from "../src/modules/payments/payments.service.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";
import { addStaff, atISO, setupSalon } from "./helpers/salon.js";

const app = createApp();
let counter = 0;

beforeEach(async () => {
  await resetDb();
  await prisma.webhookEvent.deleteMany(); // not linked to users or businesses, so resetDb leaves it
  await getQueue().obliterate({ force: true });
  vi.restoreAllMocks();
  vi.spyOn(razorpay, "createOrder").mockImplementation(async ({ amountCents }) => ({ id: `order_wh_${++counter}`, amount: amountCents, currency: "INR", status: "created" }));
});

afterAll(async () => {
  await closeQueue();
});

/** A salon with a 20% deposit and one held booking. */
async function heldBooking() {
  const salon = await setupSalon(app);
  await prisma.business.update({ where: { id: salon.businessId }, data: { depositPercent: 20 } });
  const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
  const customer = await createOwner(app);
  const res = await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, staffId: priya, startsAt: atISO("09:30") });
  return { customer, bookingId: res.body.booking.id as string, payment: res.body.payment as { orderId: string; amountCents: number } };
}

/** The event Razorpay sends when a payment is captured. */
function capturedEvent(orderId: string, amount: number, paymentId = `pay_wh_${++counter}`, event = "payment.captured") {
  return { entity: "event", event, payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: "INR", status: "captured" } } } };
}

/**
 * Sends a webhook the way Razorpay does: the signature is HMAC-SHA256 of the exact body
 * text with the webhook secret (vitest.config.ts sets the same test secret for the server).
 */
function deliver(event: object, options: { eventId?: string; secret?: string; body?: string } = {}) {
  const body = options.body ?? JSON.stringify(event);
  const signature = createHmac("sha256", options.secret ?? "test-only-webhook-secret").update(body).digest("hex");
  return request(app)
    .post("/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", signature)
    .set("X-Razorpay-Event-Id", options.eventId ?? `evt_${++counter}`)
    .send(body); // a string is sent byte for byte, like Razorpay's body
}

const bookingStatus = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;

describe("POST /webhooks/razorpay", () => {
  it("confirms a held booking when the browser never reported back", async () => {
    const { bookingId, payment } = await heldBooking();

    const res = await deliver(capturedEvent(payment.orderId, payment.amountCents, "pay_tab_closed"));

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("recorded");
    expect(await bookingStatus(bookingId)).toBe("confirmed");
    expect(await prisma.payment.findUniqueOrThrow({ where: { bookingId } })).toMatchObject({ status: "paid", providerPaymentId: "pay_tab_closed" });
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });

  it("refuses a wrong signature and changes nothing", async () => {
    const { bookingId, payment } = await heldBooking();

    const res = await deliver(capturedEvent(payment.orderId, payment.amountCents), { secret: "not-the-secret" });

    expect(res.status).toBe(400);
    expect(await bookingStatus(bookingId)).toBe("pending");
  });

  it("refuses a body changed after signing", async () => {
    const { payment } = await heldBooking();
    const signedBody = JSON.stringify(capturedEvent(payment.orderId, payment.amountCents));
    const signature = createHmac("sha256", "test-only-webhook-secret").update(signedBody).digest("hex");

    // Same JSON, different spacing: the reason the raw bytes must be checked, not re-serialised JSON.
    const res = await request(app)
      .post("/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .send(JSON.stringify(JSON.parse(signedBody), null, 2));

    expect(res.status).toBe(400);
  });

  it("refuses a request with no signature", async () => {
    const res = await request(app).post("/webhooks/razorpay").set("Content-Type", "application/json").send("{}");
    expect(res.status).toBe(400);
  });

  it("handles a repeated delivery of the same event once", async () => {
    const { payment } = await heldBooking();
    const event = capturedEvent(payment.orderId, payment.amountCents);

    const first = await deliver(event, { eventId: "evt_same" });
    const second = await deliver(event, { eventId: "evt_same" });

    expect(first.body.outcome).toBe("recorded");
    expect(second.body.outcome).toBe("duplicate-event");
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });

  it("is harmless after the browser already confirmed (and both events for one payment)", async () => {
    const { customer, bookingId, payment } = await heldBooking();
    const paymentId = "pay_both_ways";
    const razorpaySignature = createHmac("sha256", "test-only-razorpay-secret").update(`${payment.orderId}|${paymentId}`).digest("hex");
    await request(app).post(`/me/bookings/${bookingId}/pay`).set(customer.auth).send({ razorpayOrderId: payment.orderId, razorpayPaymentId: paymentId, razorpaySignature }).expect(200);

    const captured = await deliver(capturedEvent(payment.orderId, payment.amountCents, paymentId));
    const orderPaid = await deliver(capturedEvent(payment.orderId, payment.amountCents, paymentId, "order.paid"));

    expect([captured.body.outcome, orderPaid.body.outcome]).toEqual(["already-handled", "already-handled"]);
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });

  it("browser and webhook arriving at the same moment write one ledger row", async () => {
    const { customer, bookingId, payment } = await heldBooking();
    const paymentId = "pay_race";
    const razorpaySignature = createHmac("sha256", "test-only-razorpay-secret").update(`${payment.orderId}|${paymentId}`).digest("hex");

    await Promise.all([
      request(app).post(`/me/bookings/${bookingId}/pay`).set(customer.auth).send({ razorpayOrderId: payment.orderId, razorpayPaymentId: paymentId, razorpaySignature }),
      deliver(capturedEvent(payment.orderId, payment.amountCents, paymentId)),
    ]);

    expect(await bookingStatus(bookingId)).toBe("confirmed");
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });

  it("records a payment that arrives after the hold was released, then refunds it", async () => {
    const { bookingId, payment } = await heldBooking();
    await prisma.booking.update({ where: { id: bookingId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await processHoldRelease(bookingId);

    const res = await deliver(capturedEvent(payment.orderId, payment.amountCents));

    expect(res.status).toBe(200); // never an error to Razorpay, or it would retry forever
    expect(await bookingStatus(bookingId)).toBe("cancelled");
    expect((await prisma.payment.findUniqueOrThrow({ where: { bookingId } })).status).toBe("refunded");
  });

  it("ignores a payment for the wrong amount", async () => {
    const { bookingId, payment } = await heldBooking();

    const res = await deliver(capturedEvent(payment.orderId, 100));

    expect(res.body.outcome).toBe("ignored");
    expect(await bookingStatus(bookingId)).toBe("pending");
  });

  it("answers 200 to events it doesn't handle, and to orders that aren't SlotBook's", async () => {
    await heldBooking();

    const failed = await deliver({ entity: "event", event: "payment.failed", payload: {} });
    const unknownOrder = await deliver(capturedEvent("order_from_elsewhere", 5000));

    expect([failed.status, failed.body.outcome]).toEqual([200, "ignored"]);
    expect([unknownOrder.status, unknownOrder.body.outcome]).toEqual([200, "ignored"]);
  });
});
