import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

const salon = (slug: string) => ({ name: "Glow Salon", slug, timezone: "Asia/Kolkata", address: "MG Road, Kochi" });

describe("creating a business", () => {
  it("creates it for the signed-in owner and lists it under /mine", async () => {
    const { auth } = await createOwner(app);

    const created = await request(app).post("/businesses").set(auth).send(salon("Glow-Salon"));
    expect(created.status).toBe(201);
    expect(created.body.business).toMatchObject({ name: "Glow Salon", slug: "glow-salon" }); // lower-cased

    const mine = await request(app).get("/businesses/mine").set(auth);
    expect(mine.body.businesses.map((b: { slug: string }) => b.slug)).toEqual(["glow-salon"]);
  });

  it("refuses addresses the web app uses for its own pages", async () => {
    const { auth } = await createOwner(app);

    for (const slug of ["dashboard", "assets", "Admin"]) {
      const res = await request(app).post("/businesses").set(auth).send(salon(slug));
      expect(res.status, slug).toBe(400);
      expect(res.body.error.details.slug[0]).toMatch(/used by SlotBook/);
    }

    // "me" is refused too, by the 3-character minimum before the reserved list is checked.
    const me = await request(app).post("/businesses").set(auth).send(salon("me"));
    expect(me.status).toBe(400);
  });

  it("says SLUG_TAKEN when another business has the address", async () => {
    const first = await createOwner(app);
    const second = await createOwner(app);
    await request(app).post("/businesses").set(first.auth).send(salon("glow-salon"));

    const res = await request(app).post("/businesses").set(second.auth).send(salon("glow-salon"));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SLUG_TAKEN");
  });

  it("lets only one of two simultaneous requests take the same address", async () => {
    const first = await createOwner(app);
    const second = await createOwner(app);

    // Both start before either finishes. The unique index, not a lookup, decides the winner.
    const results = await Promise.all([
      request(app).post("/businesses").set(first.auth).send(salon("same-time")),
      request(app).post("/businesses").set(second.auth).send(salon("same-time")),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("also says SLUG_TAKEN when renaming to an address in use", async () => {
    const { auth } = await createOwner(app);
    await request(app).post("/businesses").set(auth).send(salon("first-salon"));
    const second = await request(app).post("/businesses").set(auth).send(salon("second-salon"));

    const res = await request(app).patch(`/businesses/${second.body.business.id}`).set(auth).send({ slug: "first-salon" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SLUG_TAKEN");
  });

  it("needs a signed-in user", async () => {
    const res = await request(app).post("/businesses").send(salon("no-owner"));
    expect(res.status).toBe(401);
  });
});
