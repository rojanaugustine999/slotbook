import { Prisma, type BookingStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import { badRequest, HttpError, notFound } from "../../lib/errors.js";
import { getPublicAvailability } from "../availability/availability.service.js";
import { toRange } from "../availability/availability.js";
import { getOwnedBusiness } from "../businesses/businesses.service.js";
import { cancelForBooking, runSafely, scheduleForBooking } from "../notifications/notifications.service.js";
import { checkStatusChange } from "./bookings.rules.js";
import type { CreateBookingInput, OwnerBookingsQuery, RescheduleBookingInput } from "./bookings.schema.js";

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

// Owners also need to know who the customer is.
const ownerBookingFields = {
  ...bookingFields,
  customer: { select: { id: true, name: true, email: true, phone: true } },
} as const;

const slotTaken = () => new HttpError(409, "SLOT_TAKEN", "That time slot is no longer available. Please pick another.");
const cannotChange = (reason: string) => new HttpError(409, "INVALID_STATUS_CHANGE", reason);
const changedMeanwhile = () => new HttpError(409, "BOOKING_CHANGED", "This booking was just changed. Please reload and try again.");

// True when Postgres refused an insert because of the no_double_booking rule
// (the exclusion constraint from the very first migration).
function isDoubleBooking(err: unknown): boolean {
  return String((err as { message?: string })?.message ?? "").includes("no_double_booking");
}

// True when an update's WHERE matched no row (Prisma error P2025).
function isNoRowMatched(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

function parseWholeMinute(iso: string): Date {
  const moment = new Date(iso);
  if (moment.getSeconds() !== 0 || moment.getMilliseconds() !== 0) throw badRequest("startsAt must be on a whole minute");
  return moment;
}

// Is `startsAt` one of the slots the availability code offers right now?
// Returns that slot (with the staff who are free then), or undefined.
async function findOfferedSlot(args: {
  slug: string;
  timezone: string;
  serviceId: string;
  startsAt: Date;
  staffId?: string;
  ignoreBookingId?: string;
}) {
  const local = DateTime.fromJSDate(args.startsAt, { zone: args.timezone });
  const availability = await getPublicAvailability(
    args.slug,
    { serviceId: args.serviceId, date: local.toFormat("yyyy-MM-dd"), staffId: args.staffId },
    { ignoreBookingId: args.ignoreBookingId },
  );
  return availability.slots.find((s) => s.time === local.toFormat("HH:mm"));
}

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOMER ACTIONS
// ═════════════════════════════════════════════════════════════════════════════

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

  const startsAt = parseWholeMinute(input.startsAt);

  // Layer 1: look the slot up in the same list the customer was shown.
  const slot = await findOfferedSlot({ slug, timezone: business.timezone, serviceId: input.serviceId, startsAt, staffId: input.staffId });
  if (!slot) throw slotTaken();

  // The server decides when it ends: service length plus cleanup buffer.
  const endsAt = new Date(startsAt.getTime() + (service.durationMin + service.bufferMin) * MINUTE_MS);

  // Layer 2: try to save. If the customer chose "anyone", slot.staffIds may hold
  // several people; when one was just taken by another customer, try the next.
  for (const staffId of slot.staffIds) {
    let created;
    try {
      created = await prisma.booking.create({
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
      continue; // this staff member was just taken: try the next one
    }

    // Saved. Now queue the confirmation and reminders. This sits OUTSIDE the
    // try above (a queue problem is not a double booking) and is wrapped so that
    // a Redis outage can never make a successful booking look like a failure.
    await runSafely("schedule reminders", () => scheduleForBooking(created.id));
    return created;
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

// Loads one of the customer's bookings and checks they may still change it:
// it must be active and must not have started yet.
async function getMyChangeableBooking(customerId: string, bookingId: string) {
  // Filtering by customerId means someone else's booking looks exactly like
  // a booking that doesn't exist: 404 either way, nothing leaks.
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, customerId },
    include: { business: { select: { slug: true, timezone: true } }, service: { select: { durationMin: true, bufferMin: true } } },
  });
  if (!booking) throw notFound("Booking not found");

  const reason = checkStatusChange(booking.status, "cancelled", booking.startsAt, new Date());
  if (reason) throw cannotChange(reason);
  if (booking.startsAt <= new Date()) throw cannotChange("This booking has already started");

  return booking;
}

export async function cancelMyBooking(customerId: string, bookingId: string) {
  const booking = await getMyChangeableBooking(customerId, bookingId);

  // "Check, then guarded update": the WHERE repeats the status we checked.
  // If the owner changed the booking in the moment between, no row matches
  // and we report that, instead of overwriting their change.
  let cancelled;
  try {
    cancelled = await prisma.booking.update({
      where: { id: booking.id, status: booking.status },
      data: { status: "cancelled" },
      select: bookingFields,
    });
  } catch (err) {
    if (isNoRowMatched(err)) throw changedMeanwhile();
    throw err;
  }

  // Stop the reminders, and tell the customer it's cancelled.
  await runSafely("cancel reminders", () => cancelForBooking(booking.id, { notifyCustomer: true }));
  return cancelled;
}

// Moves a booking to a new time (and optionally a different staff member).
// The booking keeps its id, so it is one booking that moved, not a new one.
export async function rescheduleMyBooking(customerId: string, bookingId: string, input: RescheduleBookingInput) {
  const booking = await getMyChangeableBooking(customerId, bookingId);
  const startsAt = parseWholeMinute(input.startsAt);
  const staffId = input.staffId ?? booking.staffId; // default: keep the same person

  // Layer 1, ignoring this booking itself so it doesn't block its own new time.
  const slot = await findOfferedSlot({
    slug: booking.business.slug,
    timezone: booking.business.timezone,
    serviceId: booking.serviceId,
    startsAt,
    staffId,
    ignoreBookingId: booking.id,
  });
  if (!slot) throw slotTaken();

  const endsAt = new Date(startsAt.getTime() + (booking.service.durationMin + booking.service.bufferMin) * MINUTE_MS);

  // Layer 2: updating the row in place. Postgres checks the new times against
  // every OTHER booking, so the double-booking rule still protects us here.
  let moved;
  try {
    moved = await prisma.booking.update({
      where: { id: booking.id, status: booking.status },
      data: { startsAt, endsAt, staffId },
      select: bookingFields,
    });
  } catch (err) {
    if (isDoubleBooking(err)) throw slotTaken();
    if (isNoRowMatched(err)) throw changedMeanwhile();
    throw err;
  }

  // The old reminders were for the old time. Drop them (without telling the
  // customer it was "cancelled") and plan fresh ones, including a new confirmation.
  await runSafely("replace reminders", async () => {
    await cancelForBooking(booking.id, { notifyCustomer: false });
    await scheduleForBooking(booking.id);
  });
  return moved;
}

// ═════════════════════════════════════════════════════════════════════════════
// OWNER ACTIONS
// ═════════════════════════════════════════════════════════════════════════════

// The salon's bookings between two local dates (both included), soonest first.
export async function listBusinessBookings(businessId: string, userId: string, query: OwnerBookingsQuery) {
  const business = await getOwnedBusiness(businessId, userId);

  const from = DateTime.fromISO(query.from, { zone: business.timezone });
  const to = DateTime.fromISO(query.to, { zone: business.timezone });
  if (!from.isValid || !to.isValid) throw badRequest("from and to must be real calendar dates");

  // From 00:00 on the first day to 24:00 on the last day, in the salon's timezone.
  const rangeStart = toRange(query.from, business.timezone, 0, 1440).startsAt;
  const rangeEnd = toRange(query.to, business.timezone, 0, 1440).endsAt;

  return prisma.booking.findMany({
    where: {
      businessId,
      startsAt: { gte: rangeStart, lt: rangeEnd }, // gte = greater than or equal
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    orderBy: { startsAt: "asc" },
    select: ownerBookingFields,
  });
}

// The same bookings as the list above, grouped by LOCAL day, for drawing a calendar.
// Every day in the range appears, even with no bookings, so the frontend can draw
// an empty cell without working out which dates are missing.
export async function getCalendar(businessId: string, userId: string, query: OwnerBookingsQuery) {
  const business = await getOwnedBusiness(businessId, userId);
  const bookings = await listBusinessBookings(businessId, userId, query);

  const days: { date: string; bookings: typeof bookings }[] = [];
  const byDate = new Map<string, typeof bookings>();

  const last = DateTime.fromISO(query.to, { zone: business.timezone });
  for (let d = DateTime.fromISO(query.from, { zone: business.timezone }); d <= last; d = d.plus({ days: 1 })) {
    const date = d.toFormat("yyyy-MM-dd");
    const list: typeof bookings = [];
    byDate.set(date, list);
    days.push({ date, bookings: list });
  }

  // A booking belongs to the day it starts on IN THE SALON, not the UTC day.
  for (const booking of bookings) {
    const date = DateTime.fromJSDate(booking.startsAt, { zone: business.timezone }).toFormat("yyyy-MM-dd");
    byDate.get(date)?.push(booking);
  }

  return { timezone: business.timezone, days };
}

// Owners mark what happened: completed, no_show, or cancel on the customer's behalf.
export async function changeBookingStatus(businessId: string, bookingId: string, userId: string, to: BookingStatus) {
  await getOwnedBusiness(businessId, userId);

  const booking = await prisma.booking.findFirst({ where: { id: bookingId, businessId } });
  if (!booking) throw notFound("Booking not found");

  const reason = checkStatusChange(booking.status, to, booking.startsAt, new Date());
  if (reason) throw cannotChange(reason);

  let updated;
  try {
    updated = await prisma.booking.update({
      where: { id: booking.id, status: booking.status },
      data: { status: to },
      select: ownerBookingFields,
    });
  } catch (err) {
    if (isNoRowMatched(err)) throw changedMeanwhile();
    throw err;
  }

  // The owner cancelled it: same as a customer cancelling. (completed and no_show
  // happen after the start, so no reminders are left to stop.)
  if (to === "cancelled") {
    await runSafely("cancel reminders", () => cancelForBooking(booking.id, { notifyCustomer: true }));
  }
  return updated;
}
