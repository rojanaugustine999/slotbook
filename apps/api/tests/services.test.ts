import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { resetDb } from "./helpers/db.js";
import { createBusiness, createOwner, createService } from "./helpers/factory.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

describe("services", () => {
  it("adds services and lists them A to Z", async () => {
    const { auth } = await createOwner(app);
    const businessId = await createBusiness(app, auth);

    const created = await request(app)
      .post(`/businesses/${businessId}/services`)
      .set(auth)
      .send({ name: "Haircut", durationMin: 45, bufferMin: 15, priceCents: 50000 });
    expect(created.status).toBe(201);
    expect(created.body.service).toMatchObject({ name: "Haircut", durationMin: 45, bufferMin: 15, priceCents: 50000, active: true });

    await createService(app, auth, businessId, "Facial");
    const list = await request(app).get(`/businesses/${businessId}/services`).set(auth);
    expect(list.body.services.map((s: { name: string }) => s.name)).toEqual(["Facial", "Haircut"]);
  });

  it("changes only the fields that are sent", async () => {
    const { auth } = await createOwner(app);
    const businessId = await createBusiness(app, auth);
    const serviceId = await createService(app, auth, businessId, "Haircut");

    const res = await request(app).patch(`/businesses/${businessId}/services/${serviceId}`).set(auth).send({ priceCents: 60000 });
    expect(res.status).toBe(200);
    expect(res.body.service).toMatchObject({ name: "Haircut", durationMin: 30, priceCents: 60000 });
  });

  it("hides a service, keeps it in the owner's list, and can show it again", async () => {
    const { auth } = await createOwner(app);
    const businessId = await createBusiness(app, auth);
    const serviceId = await createService(app, auth, businessId, "Haircut");

    const hidden = await request(app).delete(`/businesses/${businessId}/services/${serviceId}`).set(auth);
    expect(hidden.status).toBe(204);

    // The owner still sees it (marked inactive), so it can be brought back.
    const list = await request(app).get(`/businesses/${businessId}/services`).set(auth);
    expect(list.body.services[0]).toMatchObject({ id: serviceId, active: false });

    const shown = await request(app).patch(`/businesses/${businessId}/services/${serviceId}`).set(auth).send({ active: true });
    expect(shown.body.service.active).toBe(true);
  });

  it("rejects prices with decimals, negative prices and too-short services", async () => {
    const { auth } = await createOwner(app);
    const businessId = await createBusiness(app, auth);

    const res = await request(app)
      .post(`/businesses/${businessId}/services`)
      .set(auth)
      .send({ name: "Haircut", durationMin: 2, priceCents: 499.5 });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details).sort()).toEqual(["durationMin", "priceCents"]);

    const negative = await request(app).post(`/businesses/${businessId}/services`).set(auth).send({ name: "Haircut", durationMin: 30, priceCents: -100 });
    expect(negative.status).toBe(400);
  });

  it("won't let an owner change another salon's service through their own salon's address", async () => {
    const owner = await createOwner(app);
    const mySalon = await createBusiness(app, owner.auth);
    const other = await createOwner(app);
    const otherSalon = await createBusiness(app, other.auth);
    const theirService = await createService(app, other.auth, otherSalon, "Haircut");

    const res = await request(app).patch(`/businesses/${mySalon}/services/${theirService}`).set(owner.auth).send({ priceCents: 1 });
    expect(res.status).toBe(404);

    const hide = await request(app).delete(`/businesses/${mySalon}/services/${theirService}`).set(owner.auth);
    expect(hide.status).toBe(404);
  });
});
