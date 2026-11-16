import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { toClock, toMinutes } from "../src/modules/working-hours/working-hours.schema.js";
import { resetDb } from "./helpers/db.js";
import { createBusiness, createOwner, createStaff } from "./helpers/factory.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

// Sets up one owner, one salon and one staff member, and returns what the tests need.
async function setup() {
  const { auth } = await createOwner(app);
  const businessId = await createBusiness(app, auth);
  const staffId = await createStaff(app, auth, businessId, "Priya");
  return { auth, url: `/businesses/${businessId}/staff/${staffId}/working-hours` };
}

describe("time conversion", () => {
  it("turns clock times into minutes and back", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("24:00")).toBe(1440);
    expect(toClock(570)).toBe("09:30");
    expect(toClock(1440)).toBe("24:00");
  });
});

describe("working hours", () => {
  it("starts empty for a new staff member", async () => {
    const { auth, url } = await setup();

    const res = await request(app).get(url).set(auth);

    expect(res.status).toBe(200);
    expect(res.body.hours).toEqual([]);
  });

  it("saves a week with a lunch break and returns it sorted", async () => {
    const { auth, url } = await setup();

    // Sent out of order on purpose: afternoon first, then morning, then Tuesday.
    const res = await request(app)
      .put(url)
      .set(auth)
      .send({
        hours: [
          { weekday: 1, start: "14:00", end: "18:00" },
          { weekday: 1, start: "09:00", end: "13:00" },
          { weekday: 2, start: "10:00", end: "16:00" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.hours).toEqual([
      { weekday: 1, start: "09:00", end: "13:00" },
      { weekday: 1, start: "14:00", end: "18:00" },
      { weekday: 2, start: "10:00", end: "16:00" },
    ]);
  });

  it("replaces the old week instead of adding to it", async () => {
    const { auth, url } = await setup();
    await request(app).put(url).set(auth).send({ hours: [{ weekday: 1, start: "09:00", end: "17:00" }] });

    await request(app).put(url).set(auth).send({ hours: [{ weekday: 5, start: "12:00", end: "20:00" }] });

    const res = await request(app).get(url).set(auth);
    expect(res.body.hours).toEqual([{ weekday: 5, start: "12:00", end: "20:00" }]);
  });

  it("allows blocks that touch but don't overlap", async () => {
    const { auth, url } = await setup();

    const res = await request(app)
      .put(url)
      .set(auth)
      .send({
        hours: [
          { weekday: 3, start: "09:00", end: "13:00" },
          { weekday: 3, start: "13:00", end: "17:00" },
        ],
      });

    expect(res.status).toBe(200);
  });

  it("rejects an end time that is not after the start", async () => {
    const { auth, url } = await setup();

    const res = await request(app).put(url).set(auth).send({ hours: [{ weekday: 1, start: "18:00", end: "09:00" }] });

    expect(res.status).toBe(400);
  });

  it("rejects overlapping blocks on the same day", async () => {
    const { auth, url } = await setup();

    const res = await request(app)
      .put(url)
      .set(auth)
      .send({
        hours: [
          { weekday: 1, start: "09:00", end: "13:00" },
          { weekday: 1, start: "12:00", end: "17:00" },
        ],
      });

    expect(res.status).toBe(400);
  });

  it("rejects an invalid weekday or clock time", async () => {
    const { auth, url } = await setup();

    const badDay = await request(app).put(url).set(auth).send({ hours: [{ weekday: 8, start: "09:00", end: "17:00" }] });
    const badTime = await request(app).put(url).set(auth).send({ hours: [{ weekday: 1, start: "9am", end: "17:00" }] });
    const badMinute = await request(app).put(url).set(auth).send({ hours: [{ weekday: 1, start: "09:75", end: "17:00" }] });

    expect(badDay.status).toBe(400);
    expect(badTime.status).toBe(400);
    expect(badMinute.status).toBe(400);
  });

  it("keeps the old week when a new one is rejected", async () => {
    const { auth, url } = await setup();
    await request(app).put(url).set(auth).send({ hours: [{ weekday: 1, start: "09:00", end: "17:00" }] });

    await request(app).put(url).set(auth).send({ hours: [{ weekday: 1, start: "18:00", end: "09:00" }] });

    const res = await request(app).get(url).set(auth);
    expect(res.body.hours).toEqual([{ weekday: 1, start: "09:00", end: "17:00" }]);
  });

  it("does not let another owner read or change the schedule", async () => {
    const { url } = await setup();
    const stranger = await createOwner(app);

    const read = await request(app).get(url).set(stranger.auth);
    const write = await request(app).put(url).set(stranger.auth).send({ hours: [] });

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
  });
});
