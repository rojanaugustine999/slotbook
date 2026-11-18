import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { conflict, notFound } from "../../lib/errors.js";
import { paymentsConfigured } from "../../lib/razorpay.js";
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

// ─── "That address is taken" ─────────────────────────────────────────────────
// We don't look the slug up first and then create: two owners could both see "free"
// and both try to create it. The unique index on slug makes the database decide, and
// the loser gets error P2002. We turn that into SLUG_TAKEN so the form can say so next
// to the address field (the general handler would only say "already exists").
// ──────────────────────────────────────────────────────────────────────────────
function isSlugTaken(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target; // the column(s) that clashed
  return Array.isArray(target) ? target.includes("slug") : String(target).includes("slug");
}

const slugTaken = () => conflict("That address is already taken. Try adding your area, like glow-salon-kochi.", "SLUG_TAKEN");

export async function createBusiness(ownerId: string, input: CreateBusinessInput) {
  try {
    return await prisma.business.create({ data: { ...input, ownerId } });
  } catch (err) {
    if (isSlugTaken(err)) throw slugTaken();
    throw err;
  }
}

export function listMyBusinesses(ownerId: string) {
  return prisma.business.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } });
}

export async function updateBusiness(businessId: string, userId: string, input: UpdateBusinessInput) {
  await getOwnedBusiness(businessId, userId);
  try {
    return await prisma.business.update({ where: { id: businessId }, data: input });
  } catch (err) {
    if (isSlugTaken(err)) throw slugTaken();
    throw err;
  }
}

// ─── The public list of salons (the home page) ───────────────────────────────
// Only salons that can actually take a booking: at least one shown staff member who
// offers a shown service AND has weekly hours. All three must be true of the SAME person,
// which is why they sit inside one `some`. A salon still being set up would show a booking
// page with no times, so it stays off the list until its owner finishes the checklist.
// Public fields only: no ids, no owner, no settings.
// ──────────────────────────────────────────────────────────────────────────────
const LIST_LIMIT = 100; // plenty for now; a search box would come before pagination

// Search: one word or phrase, matched anywhere in the salon's name, its address (so an area
// like "Kochi" works), or the name of a service it shows. `mode: "insensitive"` makes
// "haircut", "Haircut" and "HAIRCUT" all match. Prisma sends the text as a query parameter,
// never pasted into the SQL, so a search can't change the query (no SQL injection).
export async function listPublicBusinesses(search?: string) {
  const q = search?.trim();
  // `contains` becomes SQL `LIKE '%q%'`, where % means "anything" and _ "any one character".
  // Prisma doesn't escape them, so a search for "%" matched every salon. A backslash makes
  // Postgres treat each one as the plain character.
  const contains = { contains: q?.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const };

  const rows = await prisma.business.findMany({
    where: {
      staff: {
        some: {
          active: true,
          workingHours: { some: {} },
          services: { some: { service: { active: true } } },
        },
      },
      ...(q
        ? { OR: [{ name: contains }, { address: contains }, { services: { some: { active: true, name: contains } } }] }
        : {}),
    },
    select: {
      name: true,
      slug: true,
      address: true,
      services: { where: { active: true }, select: { name: true }, orderBy: { name: "asc" }, take: 3 },
    },
    orderBy: { name: "asc" },
    take: LIST_LIMIT,
  });
  // A few service names give each card a hint of what the salon offers.
  return rows.map(({ services, ...business }) => ({ ...business, services: services.map((s) => s.name) }));
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
      // Customers see the deposit and the cancellation rule before they book.
      depositPercent: true,
      freeCancelHours: true,
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
  // Without Razorpay keys no deposit is charged, so don't show one either.
  return { ...business, depositPercent: paymentsConfigured() ? business.depositPercent : null };
}
