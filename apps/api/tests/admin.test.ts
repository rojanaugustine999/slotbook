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
import { addStaff, atISO, setupSalon } from "./helpers/salon.js";

const app = createApp();
let counter = 0;

beforeEach(async () => {
  await resetDb();
  await getQueue().obliterate({ force: true });
  vi.restoreAllMocks();
  vi.spyOn(razorpay, "createOrder").mockImplementation(async ({ amountCents }) => ({ id: `order_ad_${++counter}`, amount: amountCents, currency: "INR", status: "created" }));
  vi.spyOn(razorpay, "refundPayment").mockImplementation(async (_p, { amountCents, notes }) => ({ id: `rfnd_ad_${++counter}`, amount: amountCents, status: "processed", notes }));
  vi.spyOn(razorpay, "listRefunds").mockResolvedValue([]);
});

afterAll(async () => {
  await closeQueue();
});

/** A registered user made admin the way `npm run admin:grant` does: straight in the database. */
async function createAdmin() {
  const { auth } = await createOwner(app);
  const me = await request(app).get("/auth/me").set(auth);
  await prisma.user.update({ where: { id: me.body.user.id }, data: { isPlatformAdmin: true } });
  return { auth, id: me.body.user.id as string };
}

/** A salon (20% deposit) with one paid ₹300 Haircut deposit of ₹60, then settled as given. */
async function salonWithDeposit(settle?: "keep" | "refund") {
  const salon = await setupSalon(app);
  await prisma.business.update({ where: { id: salon.businessId }, data: { depositPercent: 20 } });
  const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
  const customer = await createOwner(app);
  const { body } = await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, staffId: priya, startsAt: atISO("09:30") });
  const paymentId = `pay_ad_${++counter}`;
  const razorpaySignature = createHmac("sha256", "test-only-razorpay-secret").update(`${body.payment.orderId}|${paymentId}`).digest("hex");
  await request(app).post(`/me/bookings/${body.booking.id}/pay`).set(customer.auth).send({ razorpayOrderId: body.payment.orderId, razorpayPaymentId: paymentId, razorpaySignature }).expect(200);
  if (settle === "keep") await settleDeposit(body.booking.id, { kind: "completed" });
  if (settle === "refund") await settleDeposit(body.booking.id, { kind: "salon_cancelled" });
  return { salon, bookingId: body.booking.id as string };
}

describe("who can use /admin", () => {
  it("is 404 for a normal user, so the admin area doesn't admit it exists", async () => {
    const { auth } = await createOwner(app);
    expect((await request(app).get("/admin/balances").set(auth)).status).toBe(404);
  });

  it("is 401 without a login", async () => {
    expect((await request(app).get("/admin/balances")).status).toBe(401);
  });

  it("taking admin away works at once, even with a token issued while still admin", async () => {
    const admin = await createAdmin();
    expect((await request(app).get("/admin/balances").set(admin.auth)).status).toBe(200);

    await prisma.user.update({ where: { id: admin.id }, data: { isPlatformAdmin: false } });

    expect((await request(app).get("/admin/balances").set(admin.auth)).status).toBe(404);
  });

  it("/auth/me tells the web app whether to show the Admin link", async () => {
    const admin = await createAdmin();
    expect((await request(app).get("/auth/me").set(admin.auth)).body.user.isPlatformAdmin).toBe(true);
  });
});

describe("GET /admin/balances", () => {
  it("adds up each salon's ledger: deposit minus commission", async () => {
    const admin = await createAdmin();
    const { salon } = await salonWithDeposit("keep");

    const res = await request(app).get("/admin/balances").set(admin.auth);

    expect(res.body.balances).toEqual([
      expect.objectContaining({ id: salon.businessId, totals: { deposit: 6000, commission: -600, refund: 0, payout: 0 }, balanceCents: 5400 }),
    ]);
  });

  it("a refunded deposit nets to zero", async () => {
    const admin = await createAdmin();
    await salonWithDeposit("refund");

    const res = await request(app).get("/admin/balances").set(admin.auth);

    expect(res.body.balances[0].balanceCents).toBe(0);
  });
});

describe("POST /admin/businesses/:id/payouts", () => {
  it("records the payout, lowers the balance and writes the audit log", async () => {
    const admin = await createAdmin();
    const { salon } = await salonWithDeposit("keep");

    const res = await request(app).post(`/admin/businesses/${salon.businessId}/payouts`).set(admin.auth).send({ amountCents: 5000, reference: "UTR123" });

    expect(res.status).toBe(201);
    const balances = (await request(app).get("/admin/balances").set(admin.auth)).body.balances;
    expect(balances[0]).toMatchObject({ balanceCents: 400, totals: { payout: -5000 } });
    const log = (await request(app).get("/admin/audit").set(admin.auth)).body.entries;
    expect(log[0]).toMatchObject({ action: "payout.record", targetId: salon.businessId, details: { amountCents: 5000, reference: "UTR123" } });
  });

  it("refuses more than the salon is owed", async () => {
    const admin = await createAdmin();
    const { salon } = await salonWithDeposit("keep");

    const res = await request(app).post(`/admin/businesses/${salon.businessId}/payouts`).set(admin.auth).send({ amountCents: 5401 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYOUT_TOO_LARGE");
    expect(await prisma.auditLog.count()).toBe(0); // refused, so nothing logged either
  });

  it("two payouts at the same moment can't overdraw (the second sees the first)", async () => {
    const admin = await createAdmin();
    const { salon } = await salonWithDeposit("keep"); // ₹54 owed

    const both = await Promise.all(
      [1, 2].map(() => request(app).post(`/admin/businesses/${salon.businessId}/payouts`).set(admin.auth).send({ amountCents: 5400 })),
    );

    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.payout.count()).toBe(1);
  });

  it("isn't open to a salon's own owner", async () => {
    const { salon } = await salonWithDeposit("keep");
    const res = await request(app).post(`/admin/businesses/${salon.businessId}/payouts`).set(salon.auth).send({ amountCents: 100 });
    expect(res.status).toBe(404);
  });
});

describe("refunds that need attention", () => {
  it("lists pending refunds, and retrying sends them to Razorpay (logged)", async () => {
    const admin = await createAdmin();
    await salonWithDeposit("refund"); // queued, but no worker runs in tests: still pending

    const list = await request(app).get("/admin/refunds").set(admin.auth);
    expect(list.body.refunds).toEqual([expect.objectContaining({ status: "pending", amountCents: 6000, reason: "salon_cancelled" })]);

    const retry = await request(app).post(`/admin/refunds/${list.body.refunds[0].id}/retry`).set(admin.auth);

    expect(retry.status).toBe(200);
    expect(retry.body.refund.status).toBe("processed");
    expect((await request(app).get("/admin/refunds").set(admin.auth)).body.refunds).toEqual([]);
    expect(await prisma.auditLog.findFirst()).toMatchObject({ action: "refund.retry" });
  });

  it("a refund Razorpay refused gets a fresh attempt", async () => {
    const admin = await createAdmin();
    const { bookingId } = await salonWithDeposit("refund");
    const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId } } });
    await prisma.refund.update({ where: { id: refund.id }, data: { status: "failed", providerRefundId: "rfnd_refused" } });
    // Razorpay still lists the refused one with our note; it mustn't count as "already sent".
    vi.mocked(razorpay.listRefunds).mockResolvedValue([{ id: "rfnd_refused", amount: 6000, status: "failed", notes: { refundId: refund.id } }]);

    const retry = await request(app).post(`/admin/refunds/${refund.id}/retry`).set(admin.auth);

    expect(retry.body.refund).toMatchObject({ status: "processed", providerRefundId: expect.stringMatching(/^rfnd_ad_/) });
    expect(razorpay.refundPayment).toHaveBeenCalledTimes(1);
  });

  it("answers 502 and keeps it pending when Razorpay is down", async () => {
    const admin = await createAdmin();
    const { bookingId } = await salonWithDeposit("refund");
    const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId } } });
    vi.mocked(razorpay.refundPayment).mockRejectedValueOnce(new Error("Razorpay answered 503"));

    const retry = await request(app).post(`/admin/refunds/${refund.id}/retry`).set(admin.auth);

    expect(retry.status).toBe(502);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("pending");
  });
});
