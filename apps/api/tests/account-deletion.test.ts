import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { resetDb } from "./helpers/db.js";
import { addStaff, at, atISO, date, setupSalon } from "./helpers/salon.js";

const app = createApp();
const EMAIL = "asha@example.test";
const PASSWORD = "correct-horse-42";

beforeEach(async () => {
  await resetDb();
});

/** A customer signed in on one "device" (an agent keeps the refresh cookie, like a browser). */
async function customer() {
  const agent = request.agent(app);
  const res = await agent.post("/auth/register").send({ email: EMAIL, password: PASSWORD, name: "Asha Menon", phone: "+91 98765 43210" });
  return { agent, auth: { Authorization: `Bearer ${res.body.accessToken}` }, id: res.body.user.id as string };
}

const deleteMe = (me: { agent: ReturnType<typeof request.agent>; auth: Record<string, string> }, password = PASSWORD) =>
  me.agent.post("/auth/me/delete").set(me.auth).send({ password });

describe("POST /auth/me/delete", () => {
  it("needs the password, not just a session", async () => {
    const me = await customer();

    const res = await deleteMe(me, "guess-guess");

    expect([res.status, res.body.error.code]).toEqual([400, "WRONG_PASSWORD"]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).deletedAt).toBeNull();
  });

  it("needs a login", async () => {
    expect((await request(app).post("/auth/me/delete").send({ password: PASSWORD })).status).toBe(401);
  });

  it("wipes everything personal but keeps the row", async () => {
    const me = await customer();

    const res = await deleteMe(me);

    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(user).toMatchObject({ name: "Deleted user", phone: null, isPlatformAdmin: false, deletedAt: expect.any(Date) });
    expect(user.email).toBe(`deleted-${me.id}@deleted.invalid`);
  });

  it("signs out everywhere: the old password, the refresh cookie and the old access token stop working", async () => {
    const me = await customer();
    await deleteMe(me).expect(200);

    expect((await request(app).post("/auth/login").send({ email: EMAIL, password: PASSWORD })).status).toBe(401);
    expect((await me.agent.post("/auth/refresh")).status).toBe(401);
    expect((await request(app).get("/auth/me").set(me.auth)).status).toBe(401);
  });

  it("frees the email to sign up again", async () => {
    const me = await customer();
    await deleteMe(me).expect(200);

    const again = await request(app).post("/auth/register").send({ email: EMAIL, password: "new-start-123", name: "Asha", phone: "+91 98765 43210" });

    expect(again.status).toBe(201);
  });

  it("cancels upcoming bookings (freeing the slot) and keeps past ones, without their notes", async () => {
    const salon = await setupSalon(app);
    const priya = await addStaff(app, salon, "Priya", "09:00", "11:00");
    const me = await customer();
    const upcoming = await me.agent.post(`/b/${salon.slug}/bookings`).set(me.auth).send({ serviceId: salon.serviceId, staffId: priya, startsAt: atISO("09:30"), notes: "Allergic to lavender" });
    // A past visit, as the salon's history (written directly: the API can't book the past).
    const past = await prisma.booking.create({
      data: { businessId: salon.businessId, serviceId: salon.serviceId, staffId: priya, customerId: me.id, startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() - 86_400_000 + 1_800_000), priceCents: 30000, status: "completed", notes: "First visit" },
    });

    const res = await deleteMe(me);

    expect(res.body.cancelledBookings).toBe(1);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: upcoming.body.booking.id } })).toMatchObject({ status: "cancelled", notes: null });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: past.id } })).toMatchObject({ status: "completed", notes: null });
    const times = (await request(app).get(`/b/${salon.slug}/availability`).query({ serviceId: salon.serviceId, date })).body.slots.map((s: { time: string }) => s.time);
    expect(times).toContain(at("09:30").toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }));
  });

  it("refuses a salon owner, and changes nothing", async () => {
    const salon = await setupSalon(app);
    const owner = { agent: request.agent(app), auth: salon.auth };

    const res = await owner.agent.post("/auth/me/delete").set(salon.auth).send({ password: "correct-horse-42" });

    expect([res.status, res.body.error.code]).toEqual([409, "OWNS_SALON"]);
    expect(await prisma.user.count({ where: { deletedAt: { not: null } } })).toBe(0);
  });
});
