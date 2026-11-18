import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { env } from "../../lib/env.js";
import { HttpError, notFound } from "../../lib/errors.js";
import { verifyPaymentSignature } from "../../lib/razorpay.js";
import { getQueue } from "../notifications/notifications.queue.js";
import { runSafely, scheduleForBooking } from "../notifications/notifications.service.js";
import { settleDeposit } from "./payments.refunds.js";
import type { ConfirmPaymentInput } from "./payments.schema.js";

// ─── Deposits and holds ──────────────────────────────────────────────────────
// When a salon takes deposits, a new booking starts as "pending" with a hold: the slot is
// reserved for HOLD_MINUTES while the customer pays. The no_double_booking rule already
// covers pending bookings, so nobody else can take the slot during the hold.
//
// An expired hold is released in TWO places, on purpose:
//   - lazily, inside the booking transaction, before anyone else books that person
//     (releaseExpiredHolds with a staffId). This needs nothing but the database, so even
//     with Redis down an expired hold can never block a real customer;
//   - on time, by a delayed queue job (scheduleHoldRelease), so calendars and "My bookings"
//     don't keep showing "awaiting payment" after the hold has run out.
// ──────────────────────────────────────────────────────────────────────────────

export const HOLD_MINUTES = 15;

// Razorpay's smallest payment is ₹1 (100 paise).
const MIN_DEPOSIT_CENTS = 100;

/**
 * The deposit for a service, in paise, or null for "no deposit". Rounded to whole paise.
 * Services under ₹1 don't take one (Razorpay can't charge less than that).
 */
export function depositFor(priceCents: number, depositPercent: number | null): number | null {
  if (!depositPercent || priceCents < MIN_DEPOSIT_CENTS) return null;
  const deposit = Math.round((priceCents * depositPercent) / 100);
  return Math.min(priceCents, Math.max(MIN_DEPOSIT_CENTS, deposit));
}

/**
 * Cancels pending bookings whose hold has run out, and marks their unpaid payments failed.
 * Pass a staffId to release only that person's holds (inside the booking transaction), or a
 * bookingId for the queue job. Returns how many holds were released.
 */
export async function releaseExpiredHolds(db: Prisma.TransactionClient, scope: { staffId?: string; bookingId?: string }): Promise<number> {
  const expired = await db.booking.findMany({
    where: { status: "pending", holdExpiresAt: { lte: new Date() }, staffId: scope.staffId, id: scope.bookingId },
    select: { id: true },
  });
  if (expired.length === 0) return 0;

  const ids = expired.map((b) => b.id);
  // Payment row first, booking second: the same order confirmDeposit uses. Two transactions
  // that lock the same rows in opposite orders can deadlock, waiting on each other forever.
  await closeUnpaidPayments(db, ids);
  // The status condition is repeated so a payment confirmed a moment ago isn't undone.
  const { count } = await db.booking.updateMany({ where: { id: { in: ids }, status: "pending" }, data: { status: "cancelled" } });
  return count;
}

/** Marks never-paid payments of these bookings as failed (the booking was cancelled first). */
export async function closeUnpaidPayments(db: Prisma.TransactionClient, bookingIds: string[]): Promise<void> {
  await db.payment.updateMany({ where: { bookingId: { in: bookingIds }, status: "created" }, data: { status: "failed" } });
}

// ─── Confirming a payment ────────────────────────────────────────────────────

const holdExpired = () =>
  new HttpError(409, "HOLD_EXPIRED", "Your payment arrived after the booking hold ran out, so the slot was released. Your deposit will be refunded.");

/**
 * The customer paid in Razorpay Checkout and the browser sends us the three values it got back.
 * Nothing here trusts the browser: the signature proves the ids came from Razorpay, the amount
 * and order come from OUR Payment row, and the booking must belong to this customer.
 *
 * Safe to call twice (a double click, a retry after a timeout): the second call finds the
 * payment already paid and just returns the booking. Nothing is written twice.
 */
export async function confirmDeposit(customerId: string, bookingId: string, input: ConfirmPaymentInput) {
  const payment = await prisma.payment.findFirst({
    where: { bookingId, booking: { customerId } }, // someone else's booking looks like no booking: 404
    select: { id: true, businessId: true, providerOrderId: true, providerPaymentId: true, amountCents: true, status: true },
  });
  if (!payment) throw notFound("Payment not found");

  // The order id must be the one WE created for this booking, and the signature must be Razorpay's.
  if (input.razorpayOrderId !== payment.providerOrderId || !verifyPaymentSignature(payment.providerOrderId, input.razorpayPaymentId, input.razorpaySignature)) {
    throw new HttpError(400, "INVALID_SIGNATURE", "The payment could not be verified");
  }

  await recordPayment({ id: payment.id, businessId: payment.businessId, amountCents: payment.amountCents, bookingId }, input.razorpayPaymentId);

  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: paidBookingFields });
  // Paid, but the hold had been released (recordPayment has already started the refund).
  if (booking.status !== "confirmed") throw holdExpired();
  return booking;
}

/**
 * Records that a deposit was paid. The ONE place this happens: the browser route
 * (confirmDeposit) and Razorpay's webhook both end up here, in any order, possibly at the
 * same moment, and possibly more than once. Only the first call writes anything.
 * Callers must already have proved the payment is real (signature checked).
 */
export async function recordPayment(
  payment: { id: string; businessId: string; amountCents: number; bookingId: string },
  providerPaymentId: string,
): Promise<{ firstTime: boolean; confirmed: boolean }> {
  const result = await prisma.$transaction(async (tx) => {
    // The guarded update is what makes this idempotent: of two requests racing here, the
    // second waits for the first's row lock, then sees "paid" and matches nothing.
    // "failed" is allowed too: the hold was released, but the money really did arrive.
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ["created", "failed"] } },
      data: { status: "paid", providerPaymentId, paidAt: new Date() },
    });
    if (count === 0) return { firstTime: false, confirmed: false };

    // Money in: one append-only ledger row. Commission is recorded later, once the
    // deposit can no longer be refunded (settleDeposit).
    await tx.ledgerEntry.create({
      data: { businessId: payment.businessId, type: "deposit", amountCents: payment.amountCents, paymentId: payment.id, note: "Booking deposit" },
    });

    // Still held (even if the 15 minutes passed, nobody else could take a pending slot): confirm it.
    const confirmed = await tx.booking.updateMany({ where: { id: payment.bookingId, status: "pending" }, data: { status: "confirmed", holdExpiresAt: null } });
    return { firstTime: true, confirmed: confirmed.count === 1 };
  });

  // Side effects only for the call that actually confirmed the booking, so reminders are never doubled.
  if (result.firstTime && result.confirmed) {
    await runSafely("cancel hold release", () => cancelHoldRelease(payment.bookingId));
    await runSafely("schedule reminders", () => scheduleForBooking(payment.bookingId));
  }
  // The money arrived, but the slot had already been released: send it back.
  if (result.firstTime && !result.confirmed) await settleDeposit(payment.bookingId, { kind: "hold_expired" });
  return result;
}

const paidBookingFields = { id: true, status: true, startsAt: true, endsAt: true, priceCents: true, holdExpiresAt: true } as const;

/** Queues the on-time release of one hold. The job id makes it unique per booking. */
export async function scheduleHoldRelease(bookingId: string, at: Date): Promise<void> {
  await getQueue().add(
    RELEASE_HOLD_JOB,
    { bookingId },
    { jobId: `hold-${bookingId}`, delay: Math.max(0, at.getTime() - Date.now()), attempts: 3, removeOnComplete: true, removeOnFail: 100 },
  );
}

/** Drops the queued release once the deposit is paid. Harmless if it already ran. */
export async function cancelHoldRelease(bookingId: string): Promise<void> {
  await getQueue().remove(`hold-${bookingId}`);
}

export const RELEASE_HOLD_JOB = "release-hold";

/** What the queue worker runs when a hold's time is up. */
export async function processHoldRelease(bookingId: string): Promise<number> {
  return releaseExpiredHolds(prisma, { bookingId });
}

// ─── Paying later ────────────────────────────────────────────────────────────

/**
 * What Razorpay Checkout needs to pay a held booking again, for example from "My bookings"
 * after the customer closed the payment window or reloaded the page. It reuses the order
 * created at booking time, so the amount can't change and no second order is made.
 * Only while the hold is still running: after that, the slot may already be someone else's.
 */
export async function getOpenDeposit(customerId: string, bookingId: string) {
  const payment = await prisma.payment.findFirst({
    where: { bookingId, booking: { customerId } }, // someone else's booking: 404, nothing leaks
    select: { providerOrderId: true, amountCents: true, currency: true, status: true, booking: { select: { status: true, holdExpiresAt: true } } },
  });
  if (!payment) throw notFound("Payment not found");

  const { status, holdExpiresAt } = payment.booking;
  const open = payment.status === "created" && status === "pending" && holdExpiresAt !== null && holdExpiresAt > new Date();
  if (!open) throw new HttpError(409, "NOT_AWAITING_PAYMENT", "This booking isn't waiting for a deposit any more. Please reload.");

  return { orderId: payment.providerOrderId, amountCents: payment.amountCents, currency: payment.currency, keyId: env.RAZORPAY_KEY_ID ?? "" };
}
