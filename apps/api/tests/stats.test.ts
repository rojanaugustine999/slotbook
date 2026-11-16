import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { insertBookingAt, createCustomerRow, type BookingStatusName } from "./helpers/bookings.js";
import { resetDb } from "./helpers/db.js";
import { createOwner, createService, createStaff } from "./helpers/factory.js";
import { setupSalon } from "./helpers/salon.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

// A salon (India, UTC+05:30) with two services and one staff member, plus a helper
// that books at "10:00 on 2026-03-02" style local times.
async function setup() {
  const salon = await setupSalon(app);
  const haircut = salon.serviceId; // 30000 paise
  const facial = await createService(app, salon.auth, salon.businessId, "Facial");
  await prisma.service.update({ where: { id: facial }, data: { priceCents: 100000 } });
  const staffId = await createStaff(app, salon.auth, salon.businessId, "Priya");
  const customer = await createCustomerRow();

  const add = (serviceId: string, local: string, status: BookingStatusName) =>
    insertBookingAt({ businessId: salon.businessId, staffId, serviceId, customerId: customer.id, startsAt: `${local}+05:30`, status });

  return { salon, haircut, facial, staffId, customer, add };
}

const statsUrl = (businessId: string) => `/businesses/${businessId}/stats`;

describe("GET /businesses/:id/stats", () => {
  it("counts bookings by status and works out the no-show rate", async () => {
    const { salon, haircut, facial, add } = await setup();
    await add(haircut, "2026-03-02T10:00:00", "completed");
    await add(haircut, "2026-03-02T11:00:00", "completed");
    await add(haircut, "2026-03-04T10:00:00", "no_show");
    await add(facial, "2026-03-03T10:00:00", "completed");
    await add(facial, "2026-03-06T10:00:00", "confirmed");
    await add(facial, "2026-03-05T10:00:00", "cancelled");

    const res = await request(app).get(statsUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-01", to: "2026-03-07" });

    expect(res.status).toBe(200);
    expect(res.body.stats.byStatus).toEqual({ pending: 0, confirmed: 1, cancelled: 1, completed: 3, no_show: 1 });
    expect(res.body.stats.total).toBe(6);
    // 1 no-show out of 4 finished appointments (3 completed + 1 no-show).
    expect(res.body.stats.noShowRate).toBe(0.25);
  });

  it("gives bookings per day with zeros for empty days, leaving out cancelled ones", async () => {
    const { salon, haircut, facial, add } = await setup();
    await add(haircut, "2026-03-02T10:00:00", "completed");
    await add(haircut, "2026-03-02T11:00:00", "completed");
    await add(facial, "2026-03-03T10:00:00", "completed");
    await add(facial, "2026-03-05T10:00:00", "cancelled"); // doesn't count

    const res = await request(app).get(statsUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-01", to: "2026-03-05" });

    expect(res.body.stats.bookingsPerDay).toEqual([
      { date: "2026-03-01", count: 0 },
      { date: "2026-03-02", count: 2 },
      { date: "2026-03-03", count: 1 },
      { date: "2026-03-04", count: 0 },
      { date: "2026-03-05", count: 0 },
    ]);
  });

  it("puts a booking on the salon's local day, not the UTC day", async () => {
    const { salon, haircut, add } = await setup();
    // 00:30 on 7 March in India is 19:00 UTC on 6 March.
    await add(haircut, "2026-03-07T00:30:00", "confirmed");

    const res = await request(app).get(statsUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-06", to: "2026-03-07" });

    expect(res.body.stats.bookingsPerDay).toEqual([
      { date: "2026-03-06", count: 0 },
      { date: "2026-03-07", count: 1 }, // the salon's day, not the UTC day
    ]);
  });

  it("ranks services by bookings and counts revenue only from completed ones", async () => {
    const { salon, haircut, facial, add } = await setup();
    await add(haircut, "2026-03-02T10:00:00", "completed"); // 30000
    await add(haircut, "2026-03-02T11:00:00", "completed"); // 30000
    await add(haircut, "2026-03-04T10:00:00", "no_show"); // no revenue
    await add(haircut, "2026-03-06T10:00:00", "confirmed"); // upcoming: no revenue yet
    await add(facial, "2026-03-03T10:00:00", "completed"); // 100000
    await add(facial, "2026-03-05T10:00:00", "cancelled"); // not counted at all

    const res = await request(app).get(statsUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-01", to: "2026-03-07" });

    expect(res.body.stats.topServices).toEqual([
      { serviceId: haircut, name: "Haircut", bookings: 4, revenueCents: 60000 },
      { serviceId: facial, name: "Facial", bookings: 1, revenueCents: 100000 },
    ]);
  });

  it("adds up revenue from every completed booking, not just the top five services", async () => {
    const { salon, haircut, add } = await setup();
    // Six more services (30000 paise each), each with one completed booking: seven services in all.
    const extras: string[] = [];
    for (let i = 1; i <= 6; i++) extras.push(await createService(app, salon.auth, salon.businessId, `Extra ${i}`));
    await add(haircut, "2026-03-02T10:00:00", "completed"); // 30000
    for (const [i, serviceId] of extras.entries()) await add(serviceId, `2026-03-0${3 + (i % 4)}T1${i}:00:00`, "completed"); // 6 x 30000
    await add(haircut, "2026-03-06T10:00:00", "confirmed"); // upcoming: earns nothing yet
    await add(haircut, "2026-03-06T12:00:00", "no_show"); // earns nothing
    await add(haircut, "2026-03-06T14:00:00", "cancelled"); // earns nothing

    const res = await request(app).get(statsUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-01", to: "2026-03-07" });

    expect(res.body.stats.topServices).toHaveLength(5); // the list is capped...
    expect(res.body.stats.revenueCents).toBe(7 * 30000); // ...but the total is not
  });

  it("reports zero revenue when nothing has been completed", async () => {
    const { salon, haircut, add } = await setup();
    await add(haircut, "2026-03-06T10:00:00", "confirmed");

    const res = await request(app).get(statsUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-01", to: "2026-03-07" });

    expect(res.body.stats.revenueCents).toBe(0);
  });

  it("only counts bookings inside the range and inside this salon", async () => {
    const { salon, haircut, add } = await setup();
    await add(haircut, "2026-03-02T10:00:00", "completed"); // inside
    await add(haircut, "2026-02-28T10:00:00", "completed"); // the day before: outside
    await add(haircut, "2026-03-08T10:00:00", "completed"); // the day after: outside

    const other = await setupSalon(app);
    const otherStaff = await createStaff(app, other.auth, other.businessId, "Arjun");
    const customer = await createCustomerRow();
    await insertBookingAt({ businessId: other.businessId, staffId: otherStaff, serviceId: other.serviceId, customerId: customer.id, startsAt: "2026-03-02T10:00:00+05:30", status: "completed" });

    const res = await request(app).get(statsUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-01", to: "2026-03-07" });

    expect(res.body.stats.total).toBe(1);
  });

  it("handles a range with no bookings at all", async () => {
    const { salon } = await setup();

    const res = await request(app).get(statsUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-01", to: "2026-03-03" });

    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ total: 0, noShowRate: null, topServices: [] });
    expect(res.body.stats.bookingsPerDay).toHaveLength(3);
  });

  it("rejects a reversed range, one over 92 days, and a date that doesn't exist", async () => {
    const { salon } = await setup();
    const get = (query: Record<string, string>) => request(app).get(statsUrl(salon.businessId)).set(salon.auth).query(query);

    const reversed = await get({ from: "2026-03-10", to: "2026-03-01" });
    const tooLong = await get({ from: "2026-01-01", to: "2026-06-01" });
    const notReal = await get({ from: "2026-02-30", to: "2026-03-05" });

    expect([reversed.status, tooLong.status, notReal.status]).toEqual([400, 400, 400]);
  });

  it("needs a login and hides the numbers from other owners", async () => {
    const { salon } = await setup();
    const stranger = await createOwner(app);

    const anonymous = await request(app).get(statsUrl(salon.businessId)).query({ from: "2026-03-01", to: "2026-03-07" });
    const outsider = await request(app).get(statsUrl(salon.businessId)).set(stranger.auth).query({ from: "2026-03-01", to: "2026-03-07" });

    expect([anonymous.status, outsider.status]).toEqual([401, 404]);
  });
});
