import type { Express } from "express";
import request from "supertest";

// Small helpers that set up common test data through the real API,
// so each test can say what it needs in one line.

let counter = 0;

/** Registers a new user and returns the header that logs them in. */
export async function createOwner(app: Express) {
  counter += 1;
  const res = await request(app)
    .post("/auth/register")
    .send({ email: `owner${counter}@example.com`, password: "correct-horse-42", name: `Owner ${counter}` });

  return { auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

/** Creates a salon owned by the given user and returns its id. */
export async function createBusiness(app: Express, auth: { Authorization: string }) {
  counter += 1;
  const res = await request(app)
    .post("/businesses")
    .set(auth)
    .send({ name: `Salon ${counter}`, slug: `salon-${counter}`, timezone: "Asia/Kolkata" });

  return res.body.business.id as string;
}

/** Creates a service in the given salon and returns its id. */
export async function createService(app: Express, auth: { Authorization: string }, businessId: string, name: string) {
  const res = await request(app)
    .post(`/businesses/${businessId}/services`)
    .set(auth)
    .send({ name, durationMin: 30, priceCents: 30000 });

  return res.body.service.id as string;
}
