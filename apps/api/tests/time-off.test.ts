import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { resetDb } from "./helpers/db.js";
import { createBusiness, createOwner, createStaff } from "./helpers/factory.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

async function setup() {
  const { auth } = await createOwner(app);
  const businessId = await createBusiness(app, auth);
  const staffId = await createStaff(app, auth, businessId, "Priya");
  return { auth, businessId, url: `/businesses/${businessId}/staff/${staffId}/time-off` };
}

// Dates far in the future, so "upcoming" stays true whenever the tests run.
const leave = { startsAt: "2090-12-05T09:00:00+05:30", endsAt: "2090-12-05T18:00:00+05:30", reason: "Annual leave" };

describe("time off", () => {
  it("saves time off and stores the moment in UTC", async () => {
    const { auth, url } = await setup();

    const res = await request(app).post(url).set(auth).send(leave);

    expect(res.status).toBe(201);
    // 09:00 in India (+05:30) is 03:30 in UTC. Same moment, different clock.
    expect(res.body.timeOff.startsAt).toBe("2090-12-05T03:30:00.000Z");
    expect(res.body.timeOff.endsAt).toBe("2090-12-05T12:30:00.000Z");
    expect(res.body.timeOff.reason).toBe("Annual leave");
  });

  it("treats the same moment written in two timezones as equal", async () => {
    const { auth, url } = await setup();

    const india = await request(app).post(url).set(auth).send({ startsAt: "2090-12-05T09:00:00+05:30", endsAt: "2090-12-05T10:00:00+05:30" });
    const utc = await request(app).post(url).set(auth).send({ startsAt: "2090-12-05T03:30:00Z", endsAt: "2090-12-05T04:30:00Z" });

    expect(india.body.timeOff.startsAt).toBe(utc.body.timeOff.startsAt);
  });

  it("rejects a time with no timezone offset", async () => {
    const { auth, url } = await setup();

    const res = await request(app).post(url).set(auth).send({ startsAt: "2090-12-05T09:00:00", endsAt: "2090-12-05T18:00:00" });

    expect(res.status).toBe(400);
  });

  it("rejects an end that is not after the start", async () => {
    const { auth, url } = await setup();

    const res = await request(app).post(url).set(auth).send({ startsAt: leave.endsAt, endsAt: leave.startsAt });

    expect(res.status).toBe(400);
  });

  it("rejects time off longer than one year", async () => {
    const { auth, url } = await setup();

    const res = await request(app).post(url).set(auth).send({ startsAt: "2090-01-01T00:00:00Z", endsAt: "2206-01-01T00:00:00Z" });

    expect(res.status).toBe(400);
  });

  it("lists upcoming time off soonest first, and leaves out the past", async () => {
    const { auth, url } = await setup();
    await request(app).post(url).set(auth).send({ startsAt: "2091-03-01T00:00:00Z", endsAt: "2091-03-02T00:00:00Z", reason: "Later" });
    await request(app).post(url).set(auth).send({ startsAt: "2090-03-01T00:00:00Z", endsAt: "2090-03-02T00:00:00Z", reason: "Sooner" });
    await request(app).post(url).set(auth).send({ startsAt: "2020-03-01T00:00:00Z", endsAt: "2020-03-02T00:00:00Z", reason: "Long ago" });

    const res = await request(app).get(url).set(auth);

    expect(res.body.timeOff.map((t: { reason: string }) => t.reason)).toEqual(["Sooner", "Later"]);
  });

  it("deletes time off", async () => {
    const { auth, url } = await setup();
    const created = await request(app).post(url).set(auth).send(leave);

    const del = await request(app).delete(`${url}/${created.body.timeOff.id}`).set(auth);
    expect(del.status).toBe(204);

    const list = await request(app).get(url).set(auth);
    expect(list.body.timeOff).toEqual([]);

    // Deleting it a second time finds nothing.
    const again = await request(app).delete(`${url}/${created.body.timeOff.id}`).set(auth);
    expect(again.status).toBe(404);
  });

  it("can't delete another staff member's time off through your own URL", async () => {
    const { auth, businessId, url } = await setup();
    const created = await request(app).post(url).set(auth).send(leave);
    const arjun = await createStaff(app, auth, businessId, "Arjun");

    const res = await request(app).delete(`/businesses/${businessId}/staff/${arjun}/time-off/${created.body.timeOff.id}`).set(auth);

    expect(res.status).toBe(404);
    const list = await request(app).get(url).set(auth);
    expect(list.body.timeOff).toHaveLength(1); // Priya's leave is still there
  });

  it("does not let another owner add, read or delete time off", async () => {
    const { auth, url } = await setup();
    const created = await request(app).post(url).set(auth).send(leave);
    const stranger = await createOwner(app);

    const add = await request(app).post(url).set(stranger.auth).send(leave);
    const read = await request(app).get(url).set(stranger.auth);
    const del = await request(app).delete(`${url}/${created.body.timeOff.id}`).set(stranger.auth);

    expect([add.status, read.status, del.status]).toEqual([404, 404, 404]);
  });
});
