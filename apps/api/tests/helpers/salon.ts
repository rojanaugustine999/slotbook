import type { Express } from "express";
import { DateTime } from "luxon";
import request from "supertest";
import { prisma } from "../../src/lib/db.js";
import { createBusiness, createOwner, createService, createStaff } from "./factory.js";

// Shared setup for tests that need a working salon on a specific day.

export const TZ = "Asia/Kolkata"; // the timezone the factory gives every test salon

// A day one week from now, so it is always in the future and inside the booking window.
export const day = DateTime.now().setZone(TZ).plus({ days: 7 }).startOf("day");
export const date = day.toFormat("yyyy-MM-dd");

/** A real moment on the test day, from a local clock time like "09:30". */
export function at(clock: string): Date {
  const [hour, minute] = clock.split(":").map(Number);
  return day.set({ hour, minute }).toJSDate();
}

/** The same moment as ISO text with the salon's offset, the way a frontend would send it. */
export function atISO(clock: string): string {
  return DateTime.fromJSDate(at(clock), { zone: TZ }).toISO()!;
}

export type Salon = Awaited<ReturnType<typeof setupSalon>>;

/** One salon with a 30-minute "Haircut" service (no buffer). */
export async function setupSalon(app: Express) {
  const { auth } = await createOwner(app);
  const businessId = await createBusiness(app, auth);
  const { slug } = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const serviceId = await createService(app, auth, businessId, "Haircut");
  return { auth, businessId, slug, serviceId };
}

/** Adds a staff member who offers the salon's service and works the given hours on the test day. */
export async function addStaff(app: Express, salon: Salon, name: string, start: string, end: string) {
  const staffId = await createStaff(app, salon.auth, salon.businessId, name);
  const base = `/businesses/${salon.businessId}/staff/${staffId}`;
  await request(app).put(`${base}/services`).set(salon.auth).send({ serviceIds: [salon.serviceId] });
  await request(app).put(`${base}/working-hours`).set(salon.auth).send({ hours: [{ weekday: day.weekday, start, end }] });
  return staffId;
}
