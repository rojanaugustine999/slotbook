import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import { badRequest, HttpError, notFound } from "../../lib/errors.js";
import { getPublicAvailability } from "../availability/availability.service.js";
import type { CreateBookingInput } from "./bookings.schema.js";

const MINUTE_MS = 60 * 1000;

// What we send back for a booking.
const bookingFields = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  notes: true,
  service: { select: { id: true, name: true, durationMin: true, priceCents: true } },
  staff: { select: { id: true, name: true } },
  business: { select: { name: true, slug: true, timezone: true } },
} as const;

const slotTaken = () => new HttpError(409, "SLOT_TAKEN", "That time slot is no longer available. Please pick another.");

// True when Postgres refused an insert because of the no_double_booking rule
// (the exclusion constraint from the very first migration).
function isDoubleBooking(err: unknown): boolean {
  return String((err as { message?: string })?.message ?? "").includes("no_double_booking");
}

// ─── Creating a booking: two layers of protection ────────────────────────────
// Layer 1 (polite): ask the availability code "is this slot really offered?".
//   This catches honest mistakes: outside working hours, during time off, too
//   little notice, a time that isn't on the slot grid.
//
// Layer 2 (strict): the database's no_double_booking rule.
//   Layer 1 alone is NOT safe. Two customers can both pass the check in the same
//   millisecond, before either has saved. Only the database sees both inserts,
//   so only the database can guarantee that exactly one wins.
// ──────────────────────────────────────────────────────────────────────────────
export async function createBooking(slug: string, customerId: string, input: CreateBookingInput) {
  const business = await prisma.business.findUnique({ where: { slug }, select: { id: true, timezone: true } });
  if (!business) throw notFound("Business not found");

  const service = await prisma.service.findFirst({
    where: { id: input.serviceId, businessId: business.id, active: true },
    select: { durationMin: true, bufferMin: true },
  });
  if (!service) throw notFound("Service not found");

  const startsAt = new Date(input.startsAt);
  if (startsAt.getSeconds() !== 0 || startsAt.getMilliseconds() !== 0) {
    throw badRequest("startsAt must be on a whole minute");
  }

  // Layer 1: look the slot up in the same list the customer was shown.
  const local = DateTime.fromJSDate(startsAt, { zone: business.timezone });
  const availability = await getPublicAvailability(slug, {
    serviceId: input.serviceId,
    date: local.toFormat("yyyy-MM-dd"),
    staffId: input.staffId,
  });
  const slot = availability.slots.find((s) => s.time === local.toFormat("HH:mm"));
  if (!slot) throw slotTaken();

  // The server decides when it ends: service length plus cleanup buffer.
  const endsAt = new Date(startsAt.getTime() + (service.durationMin + service.bufferMin) * MINUTE_MS);

  // Layer 2: try to save. If the customer chose "anyone", slot.staffIds may hold
  // several people; when one was just taken by another customer, try the next.
  for (const staffId of slot.staffIds) {
    try {
      return await prisma.booking.create({
        data: {
          businessId: business.id,
          serviceId: input.serviceId,
          staffId,
          customerId,
          startsAt,
          endsAt,
          notes: input.notes,
          status: "confirmed",
        },
        select: bookingFields,
      });
    } catch (err) {
      if (!isDoubleBooking(err)) throw err; // a different problem: don't hide it
    }
  }

  // Everyone who was free a moment ago has since been booked.
  throw slotTaken();
}

// A customer's own bookings, upcoming ones first.
export function listMyBookings(customerId: string) {
  return prisma.booking.findMany({
    where: { customerId },
    orderBy: { startsAt: "asc" },
    select: bookingFields,
  });
}
