import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createCustomerRow, insertBookingAt } from "./helpers/bookings.js";
import { resetDb } from "./helpers/db.js";
import { createOwner, createStaff } from "./helpers/factory.js";
import { setupSalon } from "./helpers/salon.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

async function setup() {
  const salon = await setupSalon(app);
  const priya = await createStaff(app, salon.auth, salon.businessId, "Priya");
  const arjun = await createStaff(app, salon.auth, salon.businessId, "Arjun");
  const customer = await createCustomerRow();
  const add = (staffId: string, local: string) =>
    insertBookingAt({ businessId: salon.businessId, staffId, serviceId: salon.serviceId, customerId: customer.id, startsAt: `${local}+05:30`, status: "confirmed" });
  return { salon, priya, arjun, add };
}

const calendarUrl = (businessId: string) => `/businesses/${businessId}/calendar`;

describe("GET /businesses/:id/calendar", () => {
  it("groups bookings by day, soonest first, and includes empty days", async () => {
    const { salon, priya, add } = await setup();
    await add(priya, "2026-03-02T11:00:00");
    await add(priya, "2026-03-02T09:00:00");
    await add(priya, "2026-03-04T10:00:00");

    const res = await request(app).get(calendarUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-01", to: "2026-03-05" });

    expect(res.status).toBe(200);
    expect(res.body.calendar.timezone).toBe("Asia/Kolkata");
    const days = res.body.calendar.days as { date: string; bookings: { startsAt: string }[] }[];
    expect(days.map((d) => d.date)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
    expect(days.map((d) => d.bookings.length)).toEqual([0, 2, 0, 1, 0]);
    // Within a day: 09:00 (03:30 UTC) before 11:00 (05:30 UTC).
    expect(days[1]!.bookings.map((b) => b.startsAt)).toEqual(["2026-03-02T03:30:00.000Z", "2026-03-02T05:30:00.000Z"]);
  });

  it("puts a booking on the salon's local day, not the UTC day", async () => {
    const { salon, priya, add } = await setup();
    await add(priya, "2026-03-07T00:30:00"); // 19:00 UTC on 6 March

    const res = await request(app).get(calendarUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-06", to: "2026-03-07" });

    const days = res.body.calendar.days as { date: string; bookings: unknown[] }[];
    expect(days.map((d) => [d.date, d.bookings.length])).toEqual([["2026-03-06", 0], ["2026-03-07", 1]]);
  });

  it("can be limited to one staff member", async () => {
    const { salon, priya, arjun, add } = await setup();
    await add(priya, "2026-03-02T09:00:00");
    await add(arjun, "2026-03-02T09:00:00");

    const res = await request(app).get(calendarUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-02", to: "2026-03-02", staffId: arjun });

    const bookings = res.body.calendar.days[0].bookings as { staff: { name: string } }[];
    expect(bookings.map((b) => b.staff.name)).toEqual(["Arjun"]);
  });

  it("includes the customer details owners need", async () => {
    const { salon, priya, add } = await setup();
    await add(priya, "2026-03-02T09:00:00");

    const res = await request(app).get(calendarUrl(salon.businessId)).set(salon.auth).query({ from: "2026-03-02", to: "2026-03-02" });

    expect(res.body.calendar.days[0].bookings[0].customer).toMatchObject({ name: "Customer", email: expect.any(String) });
  });

  it("rejects a range over 31 days and hides the calendar from other owners", async () => {
    const { salon } = await setup();
    const stranger = await createOwner(app);

    const tooLong = await request(app).get(calendarUrl(salon.businessId)).set(salon.auth).query({ from: "2026-01-01", to: "2026-03-01" });
    const outsider = await request(app).get(calendarUrl(salon.businessId)).set(stranger.auth).query({ from: "2026-03-01", to: "2026-03-07" });

    expect([tooLong.status, outsider.status]).toEqual([400, 404]);
  });
});
