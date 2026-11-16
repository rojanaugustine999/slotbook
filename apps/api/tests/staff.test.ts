import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { resetDb } from "./helpers/db.js";
import { createBusiness, createOwner, createService } from "./helpers/factory.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

describe("staff", () => {
  it("adds a staff member and lists them", async () => {
    const { auth } = await createOwner(app);
    const businessId = await createBusiness(app, auth);

    const created = await request(app).post(`/businesses/${businessId}/staff`).set(auth).send({ name: "Priya" });
    expect(created.status).toBe(201);
    expect(created.body.staff).toMatchObject({ name: "Priya", active: true, services: [] });

    const list = await request(app).get(`/businesses/${businessId}/staff`).set(auth);
    expect(list.body.staff.map((s: { name: string }) => s.name)).toEqual(["Priya"]);
  });

  it("does not let another owner see or add staff", async () => {
    const owner = await createOwner(app);
    const businessId = await createBusiness(app, owner.auth);
    const stranger = await createOwner(app);

    const list = await request(app).get(`/businesses/${businessId}/staff`).set(stranger.auth);
    const add = await request(app).post(`/businesses/${businessId}/staff`).set(stranger.auth).send({ name: "Spy" });

    expect(list.status).toBe(404);
    expect(add.status).toBe(404);
  });
});

describe("staff services", () => {
  it("sets which services a staff member offers", async () => {
    const { auth } = await createOwner(app);
    const businessId = await createBusiness(app, auth);
    const haircut = await createService(app, auth, businessId, "Haircut");
    const facial = await createService(app, auth, businessId, "Facial");
    const staff = await request(app).post(`/businesses/${businessId}/staff`).set(auth).send({ name: "Priya" });
    const url = `/businesses/${businessId}/staff/${staff.body.staff.id}/services`;

    const res = await request(app).put(url).set(auth).send({ serviceIds: [haircut, facial] });

    expect(res.status).toBe(200);
    const names = res.body.staff.services.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(["Facial", "Haircut"]);
  });

  it("replaces the old list instead of adding to it", async () => {
    const { auth } = await createOwner(app);
    const businessId = await createBusiness(app, auth);
    const haircut = await createService(app, auth, businessId, "Haircut");
    const facial = await createService(app, auth, businessId, "Facial");
    const staff = await request(app).post(`/businesses/${businessId}/staff`).set(auth).send({ name: "Priya" });
    const url = `/businesses/${businessId}/staff/${staff.body.staff.id}/services`;

    await request(app).put(url).set(auth).send({ serviceIds: [haircut, facial] });
    const res = await request(app).put(url).set(auth).send({ serviceIds: [facial] });

    expect(res.body.staff.services.map((s: { name: string }) => s.name)).toEqual(["Facial"]);
  });

  it("refuses a service that belongs to another salon, and keeps the old list", async () => {
    const mine = await createOwner(app);
    const myBusiness = await createBusiness(app, mine.auth);
    const myService = await createService(app, mine.auth, myBusiness, "Haircut");
    const staff = await request(app).post(`/businesses/${myBusiness}/staff`).set(mine.auth).send({ name: "Priya" });
    const url = `/businesses/${myBusiness}/staff/${staff.body.staff.id}/services`;
    await request(app).put(url).set(mine.auth).send({ serviceIds: [myService] });

    const other = await createOwner(app);
    const otherBusiness = await createBusiness(app, other.auth);
    const theirService = await createService(app, other.auth, otherBusiness, "Massage");

    const res = await request(app).put(url).set(mine.auth).send({ serviceIds: [myService, theirService] });
    expect(res.status).toBe(400);

    const list = await request(app).get(`/businesses/${myBusiness}/staff`).set(mine.auth);
    expect(list.body.staff[0].services.map((s: { name: string }) => s.name)).toEqual(["Haircut"]);
  });

  it("ignores the same service sent twice", async () => {
    const { auth } = await createOwner(app);
    const businessId = await createBusiness(app, auth);
    const haircut = await createService(app, auth, businessId, "Haircut");
    const staff = await request(app).post(`/businesses/${businessId}/staff`).set(auth).send({ name: "Priya" });

    const res = await request(app)
      .put(`/businesses/${businessId}/staff/${staff.body.staff.id}/services`)
      .set(auth)
      .send({ serviceIds: [haircut, haircut] });

    expect(res.status).toBe(200);
    expect(res.body.staff.services).toHaveLength(1);
  });
});
