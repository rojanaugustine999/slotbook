import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";
import { addStaff, at, atISO, date, setupSalon } from "./helpers/salon.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

// A customer is just a registered user. createOwner registers one and returns their login header.
const createCustomer = () => createOwner(app);

describe("POST /b/:slug/bookings", () => {
  it("books an open slot", async () => {
    const salon = await setupSalon(app);
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();

    const res = await request(app)
      .post(`/b/${salon.slug}/bookings`)
      .set(customer.auth)
      .send({ serviceId: salon.serviceId, staffId: priya, startsAt: atISO("09:30"), notes: "First visit" });

    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({
      status: "confirmed",
      notes: "First visit",
      startsAt: at("09:30").toISOString(),
      endsAt: at("10:00").toISOString(), // the server added the 30-minute service length
      staff: { id: priya, name: "Priya" },
      service: { name: "Haircut" },
    });
  });

  it("removes the booked slot from availability", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    await request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, startsAt: atISO("09:30") });

    const res = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date });

    const times = res.body.slots.map((s: { time: string }) => s.time);
    expect(times).toEqual(["09:00", "10:00", "10:15", "10:30"]);
  });

  it("needs a login", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");

    const res = await request(app).post(`/b/${salon.slug}/bookings`).send({ serviceId: salon.serviceId, startsAt: atISO("09:30") });

    expect(res.status).toBe(401);
  });

  it("refuses the same slot twice", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const first = await createCustomer();
    const second = await createCustomer();
    const body = { serviceId: salon.serviceId, startsAt: atISO("09:30") };

    const a = await request(app).post(`/b/${salon.slug}/bookings`).set(first.auth).send(body);
    const b = await request(app).post(`/b/${salon.slug}/bookings`).set(second.auth).send(body);

    expect(a.status).toBe(201);
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe("SLOT_TAKEN");
  });

  it("refuses times that are not offered slots", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const book = (startsAt: string) =>
      request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, startsAt });

    const beforeOpening = await book(atISO("08:00"));
    const tooLateToFinish = await book(atISO("10:45")); // would end at 11:15, after closing
    const offTheGrid = await book(atISO("09:07"));
    const inThePast = await book("2020-01-06T09:30:00+05:30");

    expect([beforeOpening.status, tooLateToFinish.status, offTheGrid.status, inThePast.status]).toEqual([409, 409, 409, 409]);
  });

  it("refuses a time without an offset, or one with seconds", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const book = (startsAt: string) =>
      request(app).post(`/b/${salon.slug}/bookings`).set(customer.auth).send({ serviceId: salon.serviceId, startsAt });

    const noOffset = await book(`${date}T09:30:00`);
    const withSeconds = await book(atISO("09:30").replace(":00.000", ":30.000"));

    expect([noOffset.status, withSeconds.status]).toEqual([400, 400]);
  });

  it("ignores an endsAt, status or customerId sent by the client", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const victim = await createCustomer();
    const victimId = (await request(app).get("/auth/me").set(victim.auth)).body.user.id;

    const res = await request(app)
      .post(`/b/${salon.slug}/bookings`)
      .set(customer.auth)
      .send({ serviceId: salon.serviceId, startsAt: atISO("09:30"), endsAt: atISO("09:31"), status: "completed", customerId: victimId });

    expect(res.status).toBe(201);
    expect(res.body.booking.endsAt).toBe(at("10:00").toISOString());
    expect(res.body.booking.status).toBe("confirmed");
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.booking.id } });
    expect(row.customerId).not.toBe(victimId);
  });
});

// These tests register 10 customers first. Hashing a password is slow on purpose
// (that is what makes stolen hashes hard to crack), so allow more than the default 5 seconds.
const RACE_TIMEOUT_MS = 30_000;

describe("the race: many customers, one slot", () => {
  it("lets exactly 1 of 10 simultaneous bookings through", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customers = await Promise.all(Array.from({ length: 10 }, () => createCustomer()));
    const body = { serviceId: salon.serviceId, startsAt: atISO("09:30") };

    // Promise.all fires all 10 requests without waiting for any of them to finish.
    const results = await Promise.all(
      customers.map((c) => request(app).post(`/b/${salon.slug}/bookings`).set(c.auth).send(body)),
    );

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    expect(await prisma.booking.count()).toBe(1);
  }, RACE_TIMEOUT_MS);

  it("with two staff free, lets exactly 2 of 10 through, one per staff member", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    await addStaff(app, salon, "Arjun", "09:00", "11:00");
    const customers = await Promise.all(Array.from({ length: 10 }, () => createCustomer()));
    const body = { serviceId: salon.serviceId, startsAt: atISO("09:30") }; // no staffId: "anyone"

    const results = await Promise.all(
      customers.map((c) => request(app).post(`/b/${salon.slug}/bookings`).set(c.auth).send(body)),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(8);
    const rows = await prisma.booking.findMany({ select: { staffId: true } });
    expect(new Set(rows.map((r) => r.staffId)).size).toBe(2); // two different staff members
  }, RACE_TIMEOUT_MS);
});

describe("GET /me/bookings", () => {
  it("lists only your own bookings, soonest first", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await createCustomer();
    const other = await createCustomer();
    const book = (auth: { Authorization: string }, clock: string) =>
      request(app).post(`/b/${salon.slug}/bookings`).set(auth).send({ serviceId: salon.serviceId, startsAt: atISO(clock) });
    await book(me.auth, "10:30");
    await book(other.auth, "10:00");
    await book(me.auth, "09:00");

    const res = await request(app).get("/me/bookings").set(me.auth);

    expect(res.status).toBe(200);
    expect(res.body.bookings.map((b: { startsAt: string }) => b.startsAt)).toEqual([at("09:00").toISOString(), at("10:30").toISOString()]);
  });

  it("needs a login", async () => {
    const res = await request(app).get("/me/bookings");
    expect(res.status).toBe(401);
  });
});
