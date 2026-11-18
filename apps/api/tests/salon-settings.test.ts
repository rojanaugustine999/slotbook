import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";
import { addStaff, date, setupSalon, type Salon } from "./helpers/salon.js";

// What the owner's Settings tab does: PATCH /businesses/:id with some of the salon's fields.
const app = createApp();

beforeEach(async () => {
  await resetDb();
});

const update = (salon: Salon, body: object, auth: Record<string, string> = salon.auth) =>
  request(app).patch(`/businesses/${salon.businessId}`).set(auth).send(body);
const times = async (slug: string, serviceId: string) =>
  (await request(app).get(`/b/${slug}/availability`).query({ serviceId, date })).body.slots as { time: string }[];

describe("Settings tab: salon details", () => {
  it("renames the salon and changes its street address", async () => {
    const salon = await setupSalon(app);

    const res = await update(salon, { name: "Glow Studio", address: "Panampilly Nagar, Kochi" });

    expect(res.status).toBe(200);
    expect(res.body.business).toMatchObject({ name: "Glow Studio", address: "Panampilly Nagar, Kochi" });
  });

  it("is only for the owner", async () => {
    const salon = await setupSalon(app);
    const stranger = await createOwner(app);

    expect((await update(salon, { name: "Taken over" }, stranger.auth)).status).toBe(404);
  });
});

describe("Settings tab: booking page address", () => {
  it("moves the booking page; the old address stops working", async () => {
    const salon = await setupSalon(app);
    const oldSlug = salon.slug;

    await update(salon, { slug: "glow-studio-kochi" }).expect(200);

    expect((await request(app).get("/b/glow-studio-kochi")).status).toBe(200);
    expect((await request(app).get(`/b/${oldSlug}`)).status).toBe(404);
  });

  it("refuses an address another salon has, and ones SlotBook uses itself", async () => {
    const mine = await setupSalon(app);
    const theirs = await setupSalon(app);

    const taken = await update(mine, { slug: theirs.slug });
    const reserved = await update(mine, { slug: "admin" });
    const badShape = await update(mine, { slug: "Glow Salon!" });

    expect([taken.status, taken.body.error.code]).toEqual([409, "SLUG_TAKEN"]);
    expect(reserved.status).toBe(400);
    expect(badShape.status).toBe(400);
  });
});

describe("Settings tab: booking rules and timezone", () => {
  it("'book up to' closes days further ahead than it", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    expect((await times(salon.slug, salon.serviceId)).length).toBeGreaterThan(0); // the test day is 7 days ahead

    await update(salon, { maxAdvanceDays: 3 }).expect(200);

    expect(await times(salon.slug, salon.serviceId)).toEqual([]);
  });

  it("refuses rules outside their limits, and a timezone that doesn't exist", async () => {
    const salon = await setupSalon(app);

    for (const body of [{ minNoticeMinutes: -1 }, { minNoticeMinutes: 7 * 24 * 60 + 1 }, { maxAdvanceDays: 0 }, { maxAdvanceDays: 366 }, { timezone: "Asia/Atlantis" }]) {
      expect((await update(salon, body)).status).toBe(400);
    }
  });

  it("changes the timezone", async () => {
    const salon = await setupSalon(app);

    const res = await update(salon, { timezone: "Asia/Dubai" });

    expect(res.body.business.timezone).toBe("Asia/Dubai");
  });
});
