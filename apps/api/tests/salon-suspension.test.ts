import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";
import { addStaff, atISO, date, setupSalon, type Salon } from "./helpers/salon.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

/** A registered user made admin the way `npm run admin:grant` does: straight in the database. */
async function createAdmin() {
  const { auth } = await createOwner(app);
  const me = await request(app).get("/auth/me").set(auth);
  await prisma.user.update({ where: { id: me.body.user.id }, data: { isPlatformAdmin: true } });
  return auth;
}

/** A bookable salon: one service, Priya working 09:00 to 11:00 on the test day. */
async function bookableSalon() {
  const salon = await setupSalon(app);
  const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
  return { salon, priya };
}

const suspend = (auth: object, salon: Salon, reason = "Unpaid platform fees") =>
  request(app).post(`/admin/businesses/${salon.businessId}/suspend`).set(auth).send({ reason });
const book = (auth: object, salon: Salon, clock: string) =>
  request(app).post(`/b/${salon.slug}/bookings`).set(auth).send({ serviceId: salon.serviceId, startsAt: atISO(clock) });

describe("who can suspend", () => {
  it("only a SlotBook admin: a normal user and the salon's own owner get 404", async () => {
    const { salon } = await bookableSalon();
    const stranger = await createOwner(app);

    expect((await suspend(stranger.auth, salon)).status).toBe(404);
    expect((await suspend(salon.auth, salon)).status).toBe(404);
  });

  it("needs a reason, because the owner is shown it", async () => {
    const admin = await createAdmin();
    const { salon } = await bookableSalon();

    expect((await suspend(admin, salon, "")).status).toBe(400);
  });
});

describe("a suspended salon", () => {
  it("disappears from the home page list and search", async () => {
    const admin = await createAdmin();
    const { salon } = await bookableSalon();
    expect((await request(app).get("/b")).body.businesses).toHaveLength(1);

    await suspend(admin, salon).expect(200);

    expect((await request(app).get("/b")).body.businesses).toEqual([]);
    expect((await request(app).get("/b").query({ q: "Haircut" })).body.businesses).toEqual([]);
  });

  it("answers its page, its open times and new bookings with SALON_UNAVAILABLE, even when the API is called directly", async () => {
    const admin = await createAdmin();
    const { salon } = await bookableSalon();
    const customer = await createOwner(app);
    await suspend(admin, salon).expect(200);

    const page = await request(app).get(`/b/${salon.slug}`);
    const times = await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date });
    const booking = await book(customer.auth, salon, "09:30");

    for (const res of [page, times, booking]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("SALON_UNAVAILABLE");
    }
    expect(await prisma.booking.count()).toBe(0);
  });

  it("keeps its existing bookings, and the owner can still manage them", async () => {
    const admin = await createAdmin();
    const { salon } = await bookableSalon();
    const customer = await createOwner(app);
    const { body } = await book(customer.auth, salon, "09:30").expect(201);

    await suspend(admin, salon).expect(200);

    expect((await prisma.booking.findUniqueOrThrow({ where: { id: body.booking.id } })).status).toBe("confirmed");
    const cancelled = await request(app).patch(`/businesses/${salon.businessId}/bookings/${body.booking.id}/status`).set(salon.auth).send({ status: "cancelled" });
    expect(cancelled.status).toBe(200);
  });

  it("shows the owner why, and the owner can't lift it", async () => {
    const admin = await createAdmin();
    const { salon } = await bookableSalon();
    await suspend(admin, salon, "Unpaid platform fees").expect(200);

    const mine = await request(app).get("/businesses/mine").set(salon.auth);
    expect(mine.body.businesses[0]).toMatchObject({ suspendedReason: "Unpaid platform fees", suspendedAt: expect.any(String) });

    // The owner's own update ignores fields it doesn't know about.
    await request(app).patch(`/businesses/${salon.businessId}`).set(salon.auth).send({ name: "Glow Again", suspendedAt: null, suspendedReason: null }).expect(200);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: salon.businessId } })).suspendedAt).not.toBeNull();
  });
});

describe("restoring, and the audit log", () => {
  it("restore makes it bookable again; both actions are logged; repeats are refused", async () => {
    const admin = await createAdmin();
    const { salon } = await bookableSalon();
    const customer = await createOwner(app);

    await suspend(admin, salon).expect(200);
    expect((await suspend(admin, salon)).body.error.code).toBe("ALREADY_SUSPENDED");

    await request(app).post(`/admin/businesses/${salon.businessId}/restore`).set(admin).expect(200);
    expect((await request(app).post(`/admin/businesses/${salon.businessId}/restore`).set(admin)).body.error.code).toBe("NOT_SUSPENDED");

    expect((await book(customer.auth, salon, "09:30")).status).toBe(201);
    const log = await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(log.map((e) => e.action)).toEqual(["salon.suspend", "salon.restore"]);
    expect(log[0]!.details).toEqual({ reason: "Unpaid platform fees" });
  });

  it("GET /admin/businesses lists every salon with its owner and status", async () => {
    const admin = await createAdmin();
    const { salon } = await bookableSalon();
    await suspend(admin, salon).expect(200);

    const res = await request(app).get("/admin/businesses").set(admin);

    expect(res.body.businesses).toEqual([
      expect.objectContaining({ id: salon.businessId, suspendedReason: "Unpaid platform fees", owner: expect.objectContaining({ email: expect.stringContaining("@") }) }),
    ]);
  });
});
