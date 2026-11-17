import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createCustomerRow, insertBookingAt } from "./helpers/bookings.js";
import { resetDb } from "./helpers/db.js";
import { createOwner, createStaff } from "./helpers/factory.js";
import { addStaff, atISO, setupSalon } from "./helpers/salon.js";

// ─── A booking keeps the price it was made at ────────────────────────────────
// These tests describe the bug: today a booking has no price of its own, so changing a
// service's price rewrites every past booking and last month's revenue.
// They fail until bookings store a price_cents of their own.
// ──────────────────────────────────────────────────────────────────────────────

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

describe("the price on a booking", () => {
  it("is the service's price when the booking is made", async () => {
    const salon = await setupSalon(app); // Haircut costs 30000 paise (₹300)
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createOwner(app);

    const res = await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, startsAt: atISO("09:30") });

    expect(res.status).toBe(201);
    expect(res.body.booking.priceCents).toBe(30000);
  });

  it("does not change when the owner changes the service's price later", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createOwner(app);
    await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, startsAt: atISO("09:30") });

    // The owner raises the price from ₹300 to ₹450.
    await request(app).patch(`/businesses/${salon.businessId}/services/${salon.serviceId}`).set(salon.auth).send({ priceCents: 45000 });

    const mine = await request(app).get("/me/bookings").set(customer.auth);
    expect(mine.body.bookings[0].priceCents).toBe(30000); // what the customer agreed to pay
  });

  it("stays the same when the customer moves the booking after a price change", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createOwner(app);
    const made = await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, startsAt: atISO("09:30") });
    await request(app).patch(`/businesses/${salon.businessId}/services/${salon.serviceId}`).set(salon.auth).send({ priceCents: 45000 });

    // Moving it is the same appointment at a new time, so the agreed price stays.
    const moved = await request(app).post(`/me/bookings/${made.body.booking.id}/reschedule`).set(customer.auth).send({ startsAt: atISO("10:00") });
    expect(moved.status).toBe(200);
    expect(moved.body.booking.priceCents).toBe(30000);
  });

  it("keeps last month's revenue the same after a price change", async () => {
    const salon = await setupSalon(app);
    const staffId = await createStaff(app, salon.auth, salon.businessId, "Priya");
    const customer = await createCustomerRow();
    await insertBookingAt({ businessId: salon.businessId, staffId, serviceId: salon.serviceId, customerId: customer.id, startsAt: "2026-03-02T10:00:00+05:30", status: "completed" });

    await request(app).patch(`/businesses/${salon.businessId}/services/${salon.serviceId}`).set(salon.auth).send({ priceCents: 45000 });

    const stats = await request(app).get(`/businesses/${salon.businessId}/stats`).set(salon.auth).query({ from: "2026-03-01", to: "2026-03-07" });
    expect(stats.body.stats.revenueCents).toBe(30000);
    expect(stats.body.stats.topServices[0].revenueCents).toBe(30000);
  });
});
