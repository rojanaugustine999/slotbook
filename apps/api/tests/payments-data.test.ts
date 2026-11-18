import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { createCustomerRow, insertBookingAt } from "./helpers/bookings.js";
import { resetDb } from "./helpers/db.js";
import { createStaff } from "./helpers/factory.js";
import { setupSalon } from "./helpers/salon.js";

// ─── Part 1 of payments: the data, and the money rules the database enforces ──
// These tests go straight to the database on purpose: the rules must hold even if a
// future bug (or a hand-typed query) bypasses the API.
// ──────────────────────────────────────────────────────────────────────────────

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

/** A salon with one booking and its paid deposit, ready for ledger rows. */
async function paidBooking() {
  const salon = await setupSalon(app);
  const staffId = await createStaff(app, salon.auth, salon.businessId, "Priya");
  const customer = await createCustomerRow();
  const booking = await insertBookingAt({ businessId: salon.businessId, staffId, serviceId: salon.serviceId, customerId: customer.id, startsAt: "2026-12-01T10:00:00+05:30", status: "confirmed" });
  const payment = await prisma.payment.create({
    data: { bookingId: booking.id, businessId: salon.businessId, providerOrderId: `order_test_${booking.id.slice(0, 8)}`, amountCents: 6000, status: "paid", paidAt: new Date() },
  });
  return { salon, booking, payment };
}

describe("deposit settings", () => {
  it("lets an owner turn deposits on, and shows them on the public salon page", async () => {
    const salon = await setupSalon(app);
    const res = await request(app).patch(`/businesses/${salon.businessId}`).set(salon.auth).send({ depositPercent: 20, freeCancelHours: 48 });
    expect(res.status).toBe(200);
    expect(res.body.business).toMatchObject({ depositPercent: 20, freeCancelHours: 48 });

    const page = await request(app).get(`/b/${salon.slug}`);
    expect(page.body.business).toMatchObject({ depositPercent: 20, freeCancelHours: 48 });
  });

  it("starts with deposits off and a 24-hour free cancellation", async () => {
    const salon = await setupSalon(app);
    const page = await request(app).get(`/b/${salon.slug}`);
    expect(page.body.business).toMatchObject({ depositPercent: null, freeCancelHours: 24 });
  });

  it("can turn deposits off again", async () => {
    const salon = await setupSalon(app);
    await request(app).patch(`/businesses/${salon.businessId}`).set(salon.auth).send({ depositPercent: 20 });
    const res = await request(app).patch(`/businesses/${salon.businessId}`).set(salon.auth).send({ depositPercent: null });
    expect(res.body.business.depositPercent).toBeNull();
  });

  it("refuses a deposit outside 1-100% in the API, and in the database too", async () => {
    const salon = await setupSalon(app);
    for (const depositPercent of [0, 101, 12.5]) {
      const res = await request(app).patch(`/businesses/${salon.businessId}`).set(salon.auth).send({ depositPercent });
      expect(res.status, String(depositPercent)).toBe(400);
    }
    await expect(prisma.business.update({ where: { id: salon.businessId }, data: { depositPercent: 150 } })).rejects.toThrow(/businesses_deposit_percent_range/);
  });
});

describe("the ledger", () => {
  it("adds up to what the salon is owed", async () => {
    const { salon, payment } = await paidBooking();
    await prisma.ledgerEntry.createMany({
      data: [
        { businessId: salon.businessId, type: "deposit", amountCents: 6000, paymentId: payment.id },
        { businessId: salon.businessId, type: "commission", amountCents: -600, paymentId: payment.id },
      ],
    });
    const { _sum } = await prisma.ledgerEntry.aggregate({ where: { businessId: salon.businessId }, _sum: { amountCents: true } });
    expect(_sum.amountCents).toBe(5400); // ₹60 deposit minus ₹6 commission
  });

  it("can't be edited or deleted: mistakes are fixed with a new entry", async () => {
    const { salon, payment } = await paidBooking();
    const entry = await prisma.ledgerEntry.create({ data: { businessId: salon.businessId, type: "deposit", amountCents: 6000, paymentId: payment.id } });

    await expect(prisma.ledgerEntry.update({ where: { id: entry.id }, data: { amountCents: 1 } })).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).amountCents).toBe(6000);
  });

  it("refuses the wrong sign: only a deposit adds to what a salon is owed", async () => {
    const { salon, payment } = await paidBooking();
    await expect(prisma.ledgerEntry.create({ data: { businessId: salon.businessId, type: "deposit", amountCents: -6000, paymentId: payment.id } })).rejects.toThrow(/ledger_entries_sign/);
    await expect(prisma.ledgerEntry.create({ data: { businessId: salon.businessId, type: "refund", amountCents: 6000, paymentId: payment.id } })).rejects.toThrow(/ledger_entries_sign/);
  });
});

describe("payments", () => {
  it("never records the same Razorpay order or payment twice", async () => {
    const { salon, booking, payment } = await paidBooking();
    await prisma.payment.update({ where: { id: payment.id }, data: { providerPaymentId: "pay_test_1" } });

    // A second payment row for the same booking, the same order, or the same Razorpay payment is refused.
    await expect(prisma.payment.create({ data: { bookingId: booking.id, businessId: salon.businessId, providerOrderId: "order_other", amountCents: 6000 } })).rejects.toThrow();
    const other = await insertBookingAt({ businessId: salon.businessId, staffId: booking.staffId, serviceId: salon.serviceId, customerId: booking.customerId, startsAt: "2026-12-01T12:00:00+05:30", status: "confirmed" });
    await expect(prisma.payment.create({ data: { bookingId: other.id, businessId: salon.businessId, providerOrderId: payment.providerOrderId, amountCents: 6000 } })).rejects.toThrow();
    await expect(prisma.payment.create({ data: { bookingId: other.id, businessId: salon.businessId, providerOrderId: "order_x", providerPaymentId: "pay_test_1", amountCents: 6000 } })).rejects.toThrow();
  });

  it("refuses zero or negative amounts", async () => {
    const { salon } = await paidBooking();
    const customer = await createCustomerRow();
    const staffId = (await prisma.staff.findFirstOrThrow({ where: { businessId: salon.businessId } })).id;
    const booking = await insertBookingAt({ businessId: salon.businessId, staffId, serviceId: salon.serviceId, customerId: customer.id, startsAt: "2026-12-02T10:00:00+05:30", status: "confirmed" });
    await expect(prisma.payment.create({ data: { bookingId: booking.id, businessId: salon.businessId, providerOrderId: "order_zero", amountCents: 0 } })).rejects.toThrow(/payments_amount_positive/);
  });
});

describe("super admin", () => {
  it("can't be granted through the API, even by sending the field", async () => {
    const res = await request(app).post("/auth/register").send({ email: "sneaky@example.com", password: "correct-horse-42", name: "Sneaky", phone: "+91 90000 00002", isPlatformAdmin: true });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "sneaky@example.com" } });
    expect(user.isPlatformAdmin).toBe(false); // the unknown field was stripped
  });
});
