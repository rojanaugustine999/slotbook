import { prisma } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import type { CreateBusinessInput, UpdateBusinessInput } from "./businesses.schema.js";

// ─── Authorization pattern ───────────────────────────────────────────────────
// Every owner-only action starts with getOwnedBusiness(). If the business
// doesn't exist OR belongs to someone else, we answer 404 in both cases.
// Answering 403 would confirm to a stranger that the ID exists.
// Reuse this helper in the services, staff and bookings modules.
// ──────────────────────────────────────────────────────────────────────────────
export async function getOwnedBusiness(businessId: string, userId: string) {
  const business = await prisma.business.findFirst({ where: { id: businessId, ownerId: userId } });
  if (!business) throw notFound("Business not found");
  return business;
}

export function createBusiness(ownerId: string, input: CreateBusinessInput) {
  // Duplicate slug → Prisma P2002 → errorHandler responds 409.
  return prisma.business.create({ data: { ...input, ownerId } });
}

export function listMyBusinesses(ownerId: string) {
  return prisma.business.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } });
}

export async function updateBusiness(businessId: string, userId: string, input: UpdateBusinessInput) {
  await getOwnedBusiness(businessId, userId);
  return prisma.business.update({ where: { id: businessId }, data: input });
}

// Public page: only safe fields and only active services/staff.
export async function getPublicBusiness(slug: string) {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      address: true,
      services: {
        where: { active: true },
        select: { id: true, name: true, durationMin: true, priceCents: true },
        orderBy: { name: "asc" },
      },
      staff: {
        where: { active: true },
        select: { id: true, name: true, services: { select: { serviceId: true } } },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!business) throw notFound("Business not found");
  return business;
}
