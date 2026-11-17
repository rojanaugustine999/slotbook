import { DateTime } from "luxon";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { resetDb } from "./helpers/db.js";
import { createBusiness, createOwner, createService, createStaff } from "./helpers/factory.js";

const app = createApp();
const TZ = "Asia/Kolkata"; // the timezone the factory gives every test salon

// A day one week from now, so it is always in the future and inside the booking window.
const day = DateTime.now().setZone(TZ).plus({ days: 7 }).startOf("day");
const date = day.toFormat("yyyy-MM-dd");

/** A real moment on the test day, from a local clock time like "09:30". */
const at = (clock: string) => {
  const [hour, minute] = clock.split(":").map(Number);
  return day.set({ hour, minute }).toJSDate();
};

beforeEach(async () => {
  await resetDb();
});

// One salon with a 30-minute service. The factory names salons "salon-<n>".
async function setupSalon() {
  const { auth } = await createOwner(app);
  const businessId = await createBusiness(app, auth);
  const { slug } = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const serviceId = await createService(app, auth, businessId, "Haircut");
  return { auth, businessId, slug, serviceId };
}

// Adds a staff member who offers the service and works the given hours on the test day.
async function addStaff(salon: Awaited<ReturnType<typeof setupSalon>>, name: string, start: string, end: string) {
  const staffId = await createStaff(app, salon.auth, salon.businessId, name);
  const base = `/businesses/${salon.businessId}/staff/${staffId}`;
  await request(app).put(`${base}/services`).set(salon.auth).send({ serviceIds: [salon.serviceId] });
  await request(app).put(`${base}/working-hours`).set(salon.auth).send({ hours: [{ weekday: day.weekday, start, end }] });
  return staffId;
}

const times = (body: { slots: { time: string }[] }) => body.slots.map((s) => s.time);

describe("GET /b/:slug/availability", () => {
  it("needs no login and returns the open slots", async () => {
    const salon = await setupSalon();
    const priya = await addStaff(salon, "Priya", "09:00", "11:00");

    const res = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date });

    expect(res.status).toBe(200);
    expect(res.body.date).toBe(date);
    expect(res.body.timezone).toBe(TZ);
    expect(times(res.body)).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30"]);
    expect(res.body.slots[0]).toEqual({ time: "09:00", staffIds: [priya] });
  });

  it("leaves out time that is already booked, but not cancelled bookings", async () => {
    const salon = await setupSalon();
    const priya = await addStaff(salon, "Priya", "09:00", "11:00");
    const customer = await prisma.user.create({ data: { email: "c@example.com", name: "Customer", passwordHash: "x" } });
    const booking = { businessId: salon.businessId, staffId: priya, serviceId: salon.serviceId, customerId: customer.id, priceCents: 30000 };
    await prisma.booking.create({ data: { ...booking, startsAt: at("09:30"), endsAt: at("10:00"), status: "confirmed" } });
    await prisma.booking.create({ data: { ...booking, startsAt: at("10:30"), endsAt: at("11:00"), status: "cancelled" } });

    const res = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date });

    // 09:30 is taken; 10:30 is free again because that booking was cancelled.
    expect(times(res.body)).toEqual(["09:00", "10:00", "10:15", "10:30"]);
  });

  it("leaves out time off", async () => {
    const salon = await setupSalon();
    const priya = await addStaff(salon, "Priya", "09:00", "11:00");
    await request(app)
      .post(`/businesses/${salon.businessId}/staff/${priya}/time-off`)
      .set(salon.auth)
      .send({ startsAt: day.set({ hour: 10 }).toISO(), endsAt: day.set({ hour: 23 }).toISO() });

    const res = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date });

    expect(times(res.body)).toEqual(["09:00", "09:15", "09:30"]);
  });

  it("combines all staff and says who is free at each time", async () => {
    const salon = await setupSalon();
    const priya = await addStaff(salon, "Priya", "09:00", "10:00");
    const arjun = await addStaff(salon, "Arjun", "09:30", "10:30");

    const res = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date });

    expect(times(res.body)).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
    const slot = (time: string) => res.body.slots.find((s: { time: string }) => s.time === time).staffIds.sort();
    expect(slot("09:00")).toEqual([priya]);
    expect(slot("09:30")).toEqual([priya, arjun].sort());
    expect(slot("10:00")).toEqual([arjun]);
  });

  it("can be limited to one staff member", async () => {
    const salon = await setupSalon();
    await addStaff(salon, "Priya", "09:00", "10:00");
    const arjun = await addStaff(salon, "Arjun", "09:30", "10:30");

    const res = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date, staffId: arjun });

    expect(times(res.body)).toEqual(["09:30", "09:45", "10:00"]);
  });

  it("ignores staff who don't offer the service", async () => {
    const salon = await setupSalon();
    await addStaff(salon, "Priya", "09:00", "10:00");
    const facial = await createService(app, salon.auth, salon.businessId, "Facial"); // nobody offers this

    const res = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: facial, date });

    expect(res.body.slots).toEqual([]);
  });

  it("returns no slots on a day nobody works", async () => {
    const salon = await setupSalon();
    await addStaff(salon, "Priya", "09:00", "11:00");
    const nextDay = day.plus({ days: 1 }).toFormat("yyyy-MM-dd");

    const res = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date: nextDay });

    expect(res.body.slots).toEqual([]);
  });

  it("returns no slots for a past date or one too far ahead", async () => {
    const salon = await setupSalon();
    // Works every day, so only the date decides the result.
    const staffId = await createStaff(app, salon.auth, salon.businessId, "Priya");
    const base = `/businesses/${salon.businessId}/staff/${staffId}`;
    await request(app).put(`${base}/services`).set(salon.auth).send({ serviceIds: [salon.serviceId] });
    const everyDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "11:00" }));
    await request(app).put(`${base}/working-hours`).set(salon.auth).send({ hours: everyDay });

    const past = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date: "2020-01-06" });
    const tooFar = day.plus({ days: 200 }).toFormat("yyyy-MM-dd"); // the salon allows 60 days ahead
    const far = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date: tooFar });

    expect(past.body.slots).toEqual([]);
    expect(far.body.slots).toEqual([]);
  });

  it("answers 404 for an unknown salon, a hidden service, or the wrong staff member", async () => {
    const salon = await setupSalon();
    await addStaff(salon, "Priya", "09:00", "11:00");
    const hidden = await createService(app, salon.auth, salon.businessId, "Old Service");
    await request(app).delete(`/businesses/${salon.businessId}/services/${hidden}`).set(salon.auth);
    const someoneElse = "00000000-0000-4000-8000-000000000000";

    const noSalon = await request(app).get("/b/no-such-salon/availability").query({ serviceId: salon.serviceId, date });
    const hiddenService = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: hidden, date });
    const wrongStaff = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date, staffId: someoneElse });

    expect([noSalon.status, hiddenService.status, wrongStaff.status]).toEqual([404, 404, 404]);
  });

  it("answers 400 for a missing or badly written date", async () => {
    const salon = await setupSalon();

    const missing = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId });
    const wrongFormat = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date: "05-12-2026" });
    const notReal = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date: "2026-02-30" });

    expect([missing.status, wrongFormat.status, notReal.status]).toEqual([400, 400, 400]);
  });
});
