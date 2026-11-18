import { Prisma, type BookingStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import { badRequest, HttpError, notFound } from "../../lib/errors.js";
import { getPublicAvailability } from "../availability/availability.service.js";
import { toRange } from "../availability/availability.js";
import { getOwnedBusiness, salonUnavailable } from "../businesses/businesses.service.js";
import { env } from "../../lib/env.js";
import { paymentsConfigured, razorpay } from "../../lib/razorpay.js";
import { cancelForBooking, runSafely, scheduleForBooking } from "../notifications/notifications.service.js";
import {
  cancelHoldRelease,
  closeUnpaidPayments,
  depositFor,
  HOLD_MINUTES,
  releaseExpiredHolds,
  scheduleHoldRelease,
} from "../payments/payments.service.js";
import { settleDeposit } from "../payments/payments.refunds.js";
import { checkStatusChange } from "./bookings.rules.js";
import type { CreateBookingInput, OwnerBookingsQuery, RescheduleBookingInput } from "./bookings.schema.js";

const MINUTE_MS = 60 * 1000;

// What we send back for a booking.
const bookingFields = {
  id: true,
  startsAt: true,
  endsAt: true,
  priceCents: true, // the price saved with the booking, not the service's current price
  status: true,
  notes: true,
  holdExpiresAt: true, // set while a deposit is awaited
  payment: { select: { amountCents: true, currency: true, status: true } },
  service: { select: { id: true, name: true, durationMin: true, priceCents: true } },
  staff: { select: { id: true, name: true } },
  business: { select: { name: true, slug: true, timezone: true, freeCancelHours: true } },
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

// True when Postgres cancelled our write because several writes collided at the same instant:
// "deadlock detected", code 40P01. When ten customers go for one slot, each insert waits for
// the others' uncommitted rows, and two of them can end up waiting for each other. Postgres
// breaks the tie by aborting one. Nothing is wrong with the slot or the request, so the right
// answer is to try again (Postgres's own advice for this error), not to answer 500.
function isDeadlock(err: unknown): boolean {
  const message = String((err as { message?: string })?.message ?? "");
  return message.includes("40P01") || message.includes("deadlock detected");
}

// Three tries is plenty: each retry only has to outlast the few milliseconds another insert needs.
const MAX_WRITE_ATTEMPTS = 3;

// ─── Taking turns per staff member ───────────────────────────────────────────
// When ten customers try to book the same person at the same instant, their inserts each wait
// for the others' unfinished rows, and those waits can form a cycle: a deadlock. Postgres usually
// spots it and cancels one (retried below), but not always quickly; the race tests caught the
// whole pile stuck for 30 seconds. So writers for the SAME staff member queue up first, on a
// short "advisory" lock: a Postgres lock on a name (here the staff id) instead of on a row,
// held until this little transaction ends. Bookings for different people still run in parallel.
//
// The lock only puts writers in a queue. What keeps double bookings out is still the
// no_double_booking constraint: if a second customer's turn comes and the slot is gone, Postgres
// refuses the insert exactly as before.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Runs a write that the double-booking rule guards, after taking this staff member's turn.
 * Returns what the write returned, or null when the slot is taken: either Postgres said so
 * (no_double_booking), or the write kept being cancelled by collisions and we stop trying.
 * Any other error is a real problem and is thrown, untouched and not retried.
 */
async function writeUnlessTaken<T>(staffId: string, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // hashtextextended turns the id into the 64-bit number advisory locks are named by.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${staffId}::text, 0))`;
        return write(tx);
      });
    } catch (err) {
      if (isDoubleBooking(err)) return null;
      if (!isDeadlock(err)) throw err;
      if (attempt >= MAX_WRITE_ATTEMPTS) return null;
      // A short random wait, so the colliding requests don't all retry at the same instant and collide again.
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 25 * attempt));
    }
  }
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
  const business = await prisma.business.findUnique({ where: { slug }, select: { id: true, timezone: true, depositPercent: true, suspendedAt: true } });
  if (!business) throw notFound("Business not found");
  if (business.suspendedAt) throw salonUnavailable(); // checked here too, not only in the slot lookup

  const service = await prisma.service.findFirst({
    where: { id: input.serviceId, businessId: business.id, active: true },
    select: { durationMin: true, bufferMin: true, priceCents: true },
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
  // A deposit is due only when this salon asks for one AND the server has Razorpay keys.
  const depositCents = paymentsConfigured() ? depositFor(service.priceCents, business.depositPercent) : null;
  const holdExpiresAt = depositCents ? new Date(Date.now() + HOLD_MINUTES * MINUTE_MS) : null;

  for (const staffId of slot.staffIds) {
    const created = await writeUnlessTaken(staffId, async (tx) => {
      // Release this person's expired holds first, inside the same locked transaction, so a
      // hold nobody paid for can't block this customer (and nobody else can slip in meanwhile).
      await releaseExpiredHolds(tx, { staffId });
      return tx.booking.create({
        data: {
          businessId: business.id,
          serviceId: input.serviceId,
          staffId,
          customerId,
          startsAt,
          endsAt,
          // Copied from the service as it is right now, and never taken from the request:
          // a customer could otherwise send { "priceCents": 1 }. Later price changes leave it alone.
          priceCents: service.priceCents,
          notes: input.notes,
          // With a deposit, the booking only HOLDS the slot until it's paid.
          status: depositCents ? "pending" : "confirmed",
          holdExpiresAt,
        },
        select: bookingFields,
      });
    });
    if (!created) continue; // this staff member was just taken: try the next one (any other error was thrown)

    if (depositCents && holdExpiresAt) {
      const payment = await openDeposit(created.id, business.id, depositCents);
      await runSafely("schedule hold release", () => scheduleHoldRelease(created.id, holdExpiresAt));
      // Reminders wait until the deposit is paid (confirmDeposit schedules them).
      return { booking: { ...created, payment: { amountCents: depositCents, currency: "INR", status: "created" as const } }, payment };
    }

    // Saved. Now queue the confirmation and reminders. This sits OUTSIDE the
    // try above (a queue problem is not a double booking) and is wrapped so that
    // a Redis outage can never make a successful booking look like a failure.
    await runSafely("schedule reminders", () => scheduleForBooking(created.id));
    return { booking: created, payment: null };
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
/**
 * Asks Razorpay for an order and saves our Payment row for it. This is a network call, so it
 * runs AFTER the booking transaction (never hold a database lock while waiting on the internet).
 * If Razorpay can't be reached, the hold is released at once rather than left to block the slot.
 */
async function openDeposit(bookingId: string, businessId: string, amountCents: number) {
  let order;
  try {
    order = await razorpay.createOrder({ amountCents, receipt: bookingId.slice(0, 40), notes: { bookingId } });
  } catch (err) {
    await prisma.booking.updateMany({ where: { id: bookingId, status: "pending" }, data: { status: "cancelled" } });
    throw Object.assign(new HttpError(503, "PAYMENTS_UNAVAILABLE", "Payments are not available right now. Please try again in a minute."), { cause: err });
  }

  await prisma.payment.create({
    data: { bookingId, businessId, providerOrderId: order.id, amountCents, currency: "INR" },
  });
  // Everything Razorpay Checkout needs in the browser. The key id is public by design; the secret never leaves the server.
  return { orderId: order.id, amountCents, currency: "INR", keyId: env.RAZORPAY_KEY_ID ?? "" };
}

async function getMyChangeableBooking(customerId: string, bookingId: string) {
  // Filtering by customerId means someone else's booking looks exactly like
  // a booking that doesn't exist: 404 either way, nothing leaks.
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, customerId },
    include: { business: { select: { slug: true, timezone: true, freeCancelHours: true } }, service: { select: { durationMin: true, bufferMin: true } } },
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

  // A held booking given up before paying: its order can never be paid now.
  await closeUnpaidPayments(prisma, [booking.id]);
  await runSafely("cancel hold release", () => cancelHoldRelease(booking.id));
  // A paid deposit: refunded if cancelled early enough, otherwise the salon keeps it.
  const deposit = await settleDeposit(booking.id, { kind: "customer_cancelled", startsAt: booking.startsAt, now: new Date(), freeCancelHours: booking.business.freeCancelHours });

  // Stop the reminders, and tell the customer it's cancelled.
  await runSafely("cancel reminders", () => cancelForBooking(booking.id, { notifyCustomer: true }));
  // Read again only if the deposit changed, so the answer shows "refunded".
  return deposit === "refund" ? prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, select: bookingFields }) : cancelled;
}

// Moves a booking to a new time (and optionally a different staff member).
// The booking keeps its id, so it is one booking that moved, not a new one.
export async function rescheduleMyBooking(customerId: string, bookingId: string, input: RescheduleBookingInput) {
  const booking = await getMyChangeableBooking(customerId, bookingId);
  // A held booking has a Razorpay order for one exact slot: pay first, then move it.
  if (booking.status === "pending" && booking.holdExpiresAt) throw cannotChange("Pay the deposit before moving this booking");
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
    // The lock is on the person the booking moves TO: that's whose diary could clash.
    moved = await writeUnlessTaken(staffId, (tx) =>
      tx.booking.update({
        where: { id: booking.id, status: booking.status },
        data: { startsAt, endsAt, staffId },
        select: bookingFields,
      }),
    );
  } catch (err) {
    if (isNoRowMatched(err)) throw changedMeanwhile();
    throw err;
  }
  if (!moved) throw slotTaken();

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
  // What happens to a paid deposit: the salon cancelling refunds it; completed or no-show keeps it.
  const depositEvent = to === "cancelled" ? "salon_cancelled" : to === "completed" ? "completed" : to === "no_show" ? "no_show" : null;
  const deposit = depositEvent ? await settleDeposit(booking.id, { kind: depositEvent }) : null;
  if (deposit === "refund") updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, select: ownerBookingFields });

  if (to === "cancelled") {
    await closeUnpaidPayments(prisma, [booking.id]);
    await runSafely("cancel hold release", () => cancelHoldRelease(booking.id));
    await runSafely("cancel reminders", () => cancelForBooking(booking.id, { notifyCustomer: true }));
  }
  return updated;
}
