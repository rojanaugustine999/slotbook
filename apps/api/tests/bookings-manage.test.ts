import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";
import { addStaff, at, atISO, date, day, setupSalon, type Salon } from "./helpers/salon.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

type Auth = { Authorization: string };

async function createCustomer() {
  const { auth } = await createOwner(app);
  const me = await request(app).get("/auth/me").set(auth);
  return { auth, id: me.body.user.id as string };
}

/** Books a slot through the API, the way a real customer would. */
async function book(salon: Salon, auth: Auth, clock: string, staffId?: string) {
  const res = await request(app).post(`/b/${salon.slug}/bookings`).set(auth).send({ serviceId: salon.serviceId, startsAt: atISO(clock), staffId });
  return res.body.booking as { id: string };
}

/** Writes a booking straight into the database, for times the API won't accept (like the past). */
async function insertBooking(salon: Salon, staffId: string, customerId: string, startsAt: Date, status: "confirmed" | "cancelled" = "confirmed") {
  return prisma.booking.create({
    data: {
      businessId: salon.businessId,
      serviceId: salon.serviceId,
      staffId,
      customerId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
      status,
    },
  });
}

const slotTimes = async (salon: Salon) => {
  const res = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date });
  return res.body.slots.map((s: { time: string }) => s.time) as string[];
};

// ═══ Customer: cancel ═══════════════════════════════════════════════════════

describe("POST /me/bookings/:id/cancel", () => {
  it("cancels your booking and frees the slot", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:30");

    const res = await request(app).post(`/me/bookings/${booking.id}/cancel`).set(me.auth);

    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe("cancelled");
    expect(await slotTimes(salon)).toContain("09:30");
  });

  it("can't cancel someone else's booking", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const owner = await createCustomer();
    const stranger = await createCustomer();
    const booking = await book(salon, owner.auth, "09:30");

    const res = await request(app).post(`/me/bookings/${booking.id}/cancel`).set(stranger.auth);

    expect(res.status).toBe(404);
  });

  it("can't cancel twice", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:30");
    await request(app).post(`/me/bookings/${booking.id}/cancel`).set(me.auth);

    const res = await request(app).post(`/me/bookings/${booking.id}/cancel`).set(me.auth);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATUS_CHANGE");
  });

  it("can't cancel a booking that has already started", async () => {
    const salon = await setupSalon(app);
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const past = await insertBooking(salon, priya, me.id, day.minus({ days: 14 }).set({ hour: 9 }).toJSDate());

    const res = await request(app).post(`/me/bookings/${past.id}/cancel`).set(me.auth);

    expect(res.status).toBe(409);
  });
});

// ═══ Customer: reschedule ═══════════════════════════════════════════════════

describe("POST /me/bookings/:id/reschedule", () => {
  it("moves the booking: the old time opens, the new time closes", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:00");

    const res = await request(app).post(`/me/bookings/${booking.id}/reschedule`).set(me.auth).send({ startsAt: atISO("10:30") });

    expect(res.status).toBe(200);
    expect(res.body.booking.id).toBe(booking.id); // same booking, moved
    expect(res.body.booking.startsAt).toBe(at("10:30").toISOString());
    expect(res.body.booking.endsAt).toBe(at("11:00").toISOString());
    const times = await slotTimes(salon);
    expect(times).toContain("09:00");
    expect(times).not.toContain("10:30");
  });

  it("can move by a few minutes even though the new time overlaps the old one", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:30");

    const res = await request(app).post(`/me/bookings/${booking.id}/reschedule`).set(me.auth).send({ startsAt: atISO("09:45") });

    expect(res.status).toBe(200);
    expect(res.body.booking.startsAt).toBe(at("09:45").toISOString());
  });

  it("refuses a time someone else has booked, and leaves your booking as it was", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const other = await createCustomer();
    const mine = await book(salon, me.auth, "09:00");
    await book(salon, other.auth, "10:00");

    const res = await request(app).post(`/me/bookings/${mine.id}/reschedule`).set(me.auth).send({ startsAt: atISO("10:00") });

    expect(res.status).toBe(409);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.startsAt.toISOString()).toBe(at("09:00").toISOString());
  });

  it("can move to a different staff member", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const arjun = await addStaff(app, salon, "Arjun", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:30");

    const res = await request(app)
      .post(`/me/bookings/${booking.id}/reschedule`)
      .set(me.auth)
      .send({ startsAt: atISO("09:30"), staffId: arjun });

    expect(res.status).toBe(200);
    expect(res.body.booking.staff.name).toBe("Arjun");
  });

  it("can't reschedule a cancelled booking", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:30");
    await request(app).post(`/me/bookings/${booking.id}/cancel`).set(me.auth);

    const res = await request(app).post(`/me/bookings/${booking.id}/reschedule`).set(me.auth).send({ startsAt: atISO("10:00") });

    expect(res.status).toBe(409);
  });
});

// ═══ Owner: list ════════════════════════════════════════════════════════════

describe("GET /businesses/:id/bookings", () => {
  it("lists the salon's bookings in a date range, with customer details", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    await book(salon, me.auth, "10:00");
    await book(salon, me.auth, "09:00");

    const res = await request(app).get(`/businesses/${salon.businessId}/bookings`).set(salon.auth).query({ from: date, to: date });

    expect(res.status).toBe(200);
    expect(res.body.bookings).toHaveLength(2);
    expect(res.body.bookings[0].startsAt).toBe(at("09:00").toISOString()); // soonest first
    expect(res.body.bookings[0].customer).toMatchObject({ id: me.id, email: expect.any(String) });
  });

  it("leaves out other days, other salons, and filters by status", async () => {
    const salon = await setupSalon(app);
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const kept = await book(salon, me.auth, "09:00");
    await insertBooking(salon, priya, me.id, day.plus({ days: 1 }).set({ hour: 9 }).toJSDate()); // next day
    await insertBooking(salon, priya, me.id, at("10:00"), "cancelled");

    const otherSalon = await setupSalon(app);
    await addStaff(app, otherSalon, "Arjun", "09:00", "11:00");
    await book(otherSalon, me.auth, "09:30");

    const all = await request(app).get(`/businesses/${salon.businessId}/bookings`).set(salon.auth).query({ from: date, to: date });
    const confirmed = await request(app)
      .get(`/businesses/${salon.businessId}/bookings`)
      .set(salon.auth)
      .query({ from: date, to: date, status: "confirmed" });

    expect(all.body.bookings).toHaveLength(2); // today's confirmed + today's cancelled
    expect(confirmed.body.bookings.map((b: { id: string }) => b.id)).toEqual([kept.id]);
  });

  it("rejects a reversed range or one longer than 31 days", async () => {
    const salon = await setupSalon(app);
    const url = `/businesses/${salon.businessId}/bookings`;

    const reversed = await request(app).get(url).set(salon.auth).query({ from: "2026-12-10", to: "2026-12-01" });
    const tooLong = await request(app).get(url).set(salon.auth).query({ from: "2026-01-01", to: "2026-03-01" });

    expect([reversed.status, tooLong.status]).toEqual([400, 400]);
  });

  it("is hidden from other owners", async () => {
    const salon = await setupSalon(app);
    const stranger = await createCustomer();

    const res = await request(app).get(`/businesses/${salon.businessId}/bookings`).set(stranger.auth).query({ from: date, to: date });

    expect(res.status).toBe(404);
  });
});

// ═══ Owner: status changes ══════════════════════════════════════════════════

describe("PATCH /businesses/:id/bookings/:bookingId/status", () => {
  const url = (salon: Salon, bookingId: string) => `/businesses/${salon.businessId}/bookings/${bookingId}/status`;

  it("marks a past booking completed or no-show", async () => {
    const salon = await setupSalon(app);
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const lastWeek = day.minus({ days: 14 });
    const came = await insertBooking(salon, priya, me.id, lastWeek.set({ hour: 9 }).toJSDate());
    const didNotCome = await insertBooking(salon, priya, me.id, lastWeek.set({ hour: 10 }).toJSDate());

    const a = await request(app).patch(url(salon, came.id)).set(salon.auth).send({ status: "completed" });
    const b = await request(app).patch(url(salon, didNotCome.id)).set(salon.auth).send({ status: "no_show" });

    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.booking.status, b.body.booking.status]).toEqual(["completed", "no_show"]);
  });

  it("refuses to mark a future booking completed", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:30");

    const res = await request(app).patch(url(salon, booking.id)).set(salon.auth).send({ status: "completed" });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("This booking hasn't started yet");
  });

  it("lets the owner cancel, and then nothing else", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:30");

    const cancel = await request(app).patch(url(salon, booking.id)).set(salon.auth).send({ status: "cancelled" });
    const afterwards = await request(app).patch(url(salon, booking.id)).set(salon.auth).send({ status: "completed" });

    expect(cancel.status).toBe(200);
    expect(afterwards.status).toBe(409);
  });

  it("rejects statuses owners can't set", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:30");

    const res = await request(app).patch(url(salon, booking.id)).set(salon.auth).send({ status: "confirmed" });

    expect(res.status).toBe(400);
  });

  it("is hidden from other owners", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const booking = await book(salon, me.auth, "09:30");
    const stranger = await createCustomer();

    const res = await request(app).patch(url(salon, booking.id)).set(stranger.auth).send({ status: "cancelled" });

    expect(res.status).toBe(404);
  });
});
