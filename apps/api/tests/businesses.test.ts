import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { resetDb } from "./helpers/db.js";
import { createOwner, createService, createStaff } from "./helpers/factory.js";
import { addStaff, setupSalon } from "./helpers/salon.js";

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

describe("GET /b: the public list of salons", () => {
  it("lists salons that can take a booking, A to Z, with a few of their services", async () => {
    const zebra = await setupSalon(app); // factory names: "Salon N"
    await addStaff(app, zebra, "Priya", "09:00", "17:00");
    await request(app).patch(`/businesses/${zebra.businessId}`).set(zebra.auth).send({ name: "Zebra Studio", address: "MG Road, Kochi" });
    const aurora = await setupSalon(app);
    await addStaff(app, aurora, "Arjun", "10:00", "18:00");
    await request(app).patch(`/businesses/${aurora.businessId}`).set(aurora.auth).send({ name: "Aurora Spa" });

    const res = await request(app).get("/b"); // no login: anyone can see it
    expect(res.status).toBe(200);
    expect(res.body.businesses).toEqual([
      { name: "Aurora Spa", slug: aurora.slug, address: null, services: ["Haircut"] },
      { name: "Zebra Studio", slug: zebra.slug, address: "MG Road, Kochi", services: ["Haircut"] },
    ]);
  });

  it("leaves out salons still being set up", async () => {
    // Only services, nobody to book with.
    await setupSalon(app);
    // Someone who offers nothing.
    const noServices = await setupSalon(app);
    await createStaff(app, noServices.auth, noServices.businessId, "Priya");
    // Someone who offers a service but has no hours.
    const noHours = await setupSalon(app);
    const staffId = await createStaff(app, noHours.auth, noHours.businessId, "Arjun");
    await request(app).put(`/businesses/${noHours.businessId}/staff/${staffId}/services`).set(noHours.auth).send({ serviceIds: [noHours.serviceId] });

    const res = await request(app).get("/b");
    expect(res.body.businesses).toEqual([]);
  });

  it("drops a salon when its only service or person is hidden", async () => {
    const salon = await setupSalon(app);
    const priya = await addStaff(app, salon, "Priya", "09:00", "17:00");
    expect((await request(app).get("/b")).body.businesses).toHaveLength(1);

    await request(app).delete(`/businesses/${salon.businessId}/services/${salon.serviceId}`).set(salon.auth);
    expect((await request(app).get("/b")).body.businesses).toHaveLength(0);

    await request(app).patch(`/businesses/${salon.businessId}/services/${salon.serviceId}`).set(salon.auth).send({ active: true });
    await request(app).delete(`/businesses/${salon.businessId}/staff/${priya}`).set(salon.auth);
    expect((await request(app).get("/b")).body.businesses).toHaveLength(0);
  });

  it("shows only shown services, and nothing private", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "17:00");
    const hidden = await createService(app, salon.auth, salon.businessId, "Secret Treatment");
    await request(app).delete(`/businesses/${salon.businessId}/services/${hidden}`).set(salon.auth);

    const [listed] = (await request(app).get("/b")).body.businesses;
    expect(Object.keys(listed).sort()).toEqual(["address", "name", "services", "slug"]); // no id, owner or settings
    expect(listed.services).toEqual(["Haircut"]);
  });
});

describe("GET /b?q=: searching the salon list", () => {
  // Two ready salons with different names, areas and services.
  async function twoSalons() {
    const lotus = await setupSalon(app); // offers "Haircut"
    await addStaff(app, lotus, "Priya", "09:00", "17:00");
    await request(app).patch(`/businesses/${lotus.businessId}`).set(lotus.auth).send({ name: "Lotus Spa", address: "Kowdiar, Thiruvananthapuram" });

    const glow = await setupSalon(app);
    const staffId = await addStaff(app, glow, "Arjun", "09:00", "17:00");
    await request(app).patch(`/businesses/${glow.businessId}`).set(glow.auth).send({ name: "Glow Studio", address: "MG Road, Kochi" });
    const facial = await createService(app, glow.auth, glow.businessId, "Bridal Facial");
    await request(app).put(`/businesses/${glow.businessId}/staff/${staffId}/services`).set(glow.auth).send({ serviceIds: [glow.serviceId, facial] });
    return { lotus, glow };
  }
  const names = async (q: string) => (await request(app).get("/b").query({ q })).body.businesses.map((b: { name: string }) => b.name);

  it("matches the name, ignoring upper and lower case", async () => {
    await twoSalons();
    expect(await names("lotus")).toEqual(["Lotus Spa"]);
    expect(await names("GLOW")).toEqual(["Glow Studio"]);
  });

  it("matches the area in the address", async () => {
    await twoSalons();
    expect(await names("kochi")).toEqual(["Glow Studio"]);
  });

  it("matches a service the salon shows", async () => {
    await twoSalons();
    expect(await names("facial")).toEqual(["Glow Studio"]);
    expect(await names("haircut")).toEqual(["Glow Studio", "Lotus Spa"]); // both offer one
  });

  it("doesn't match a hidden service", async () => {
    const { glow } = await twoSalons();
    const facial = (await request(app).get(`/businesses/${glow.businessId}/services`).set(glow.auth)).body.services.find((s: { name: string }) => s.name === "Bridal Facial");
    await request(app).delete(`/businesses/${glow.businessId}/services/${facial.id}`).set(glow.auth);
    expect(await names("facial")).toEqual([]);
  });

  it("never finds a salon that isn't ready, even when the name matches", async () => {
    await twoSalons();
    const unfinished = await setupSalon(app); // services, but nobody to book with
    await request(app).patch(`/businesses/${unfinished.businessId}`).set(unfinished.auth).send({ name: "Lotus Express" });
    expect(await names("lotus")).toEqual(["Lotus Spa"]);
  });

  it("returns every ready salon for an empty search, and nothing for no match", async () => {
    await twoSalons();
    expect(await names("   ")).toEqual(["Glow Studio", "Lotus Spa"]);
    expect(await names("zzz")).toEqual([]);
  });

  it("treats % and _ as plain characters, not wildcards", async () => {
    const { lotus } = await twoSalons();
    expect(await names("%")).toEqual([]); // before the fix, this matched every salon
    expect(await names("_")).toEqual([]);
    await request(app).patch(`/businesses/${lotus.businessId}`).set(lotus.auth).send({ name: "Lotus 50% Off" });
    expect(await names("50%")).toEqual(["Lotus 50% Off"]);
  });

  it("refuses a search longer than 100 characters", async () => {
    const res = await request(app).get("/b").query({ q: "a".repeat(101) });
    expect(res.status).toBe(400);
  });
});
