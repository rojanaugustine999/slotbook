import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { sendEmail } from "../../lib/mailer.js";
import { ACTIVE_STATUSES } from "../bookings/bookings.rules.js";
import { buildEmail } from "./notifications.emails.js";
import { planNotifications } from "./notifications.plan.js";
import { enqueueNotification, removeQueuedNotification } from "./notifications.queue.js";

// ─── Two places hold the truth, on purpose ───────────────────────────────────
// 1. The `notifications` table in Postgres: "what should be sent, and has it been?"
// 2. The queue in Redis: "wake me up when it is time".
//
// If Redis lost its data, the table still knows what was planned. And before a
// worker sends anything it checks the TABLE (is this still scheduled? is the
// booking still active?), so a job that wasn't removed in time does no harm.
// ──────────────────────────────────────────────────────────────────────────────

// Notifications are a side effect. If Redis or the email provider has a bad day,
// the customer's booking must still succeed, so callers use this wrapper:
// it logs the problem instead of throwing.
export async function runSafely(label: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (err) {
    logger.error({ err, task: label }, "notification task failed");
  }
}

// Creates one row plus one queued job for a notification.
async function queueNotification(bookingId: string, type: "confirmation" | "reminder_24h" | "reminder_1h" | "cancellation", sendAt: Date) {
  const row = await prisma.notification.create({ data: { bookingId, type, channel: "email", sendAt } });

  try {
    await enqueueNotification(row.id, sendAt);
  } catch (err) {
    // The row says "scheduled" but no job exists. Mark it failed so the table doesn't lie.
    await prisma.notification.update({ where: { id: row.id }, data: { status: "failed" } });
    throw err;
  }
}

// Plans and queues everything a (new or moved) booking needs.
export async function scheduleForBooking(bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { startsAt: true } });

  for (const planned of planNotifications(booking.startsAt, new Date())) {
    await queueNotification(bookingId, planned.type, planned.sendAt);
  }
}

// Stops every notification that hasn't gone out yet.
// notifyCustomer: also send a "your booking was cancelled" email.
export async function cancelForBooking(bookingId: string, options: { notifyCustomer: boolean }): Promise<void> {
  const pending = await prisma.notification.findMany({ where: { bookingId, status: "scheduled" }, select: { id: true } });

  // Update the table FIRST: that alone makes the worker skip them.
  await prisma.notification.updateMany({ where: { id: { in: pending.map((n) => n.id) } }, data: { status: "cancelled" } });

  // Then tidy the queue. A failure here is harmless (see the note at the top).
  for (const { id } of pending) {
    await runSafely("remove queued job", () => removeQueuedNotification(id));
  }

  if (options.notifyCustomer) await queueNotification(bookingId, "cancellation", new Date());
}

export type ProcessResult = "sent" | "skipped" | "missing";

// What the worker does when a job becomes due. Kept apart from BullMQ so it can
// be tested by simply calling it.
export async function processNotification(notificationId: string): Promise<ProcessResult> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      booking: {
        include: {
          customer: { select: { name: true, email: true } },
          service: { select: { name: true } },
          staff: { select: { name: true } },
          business: { select: { name: true, address: true, timezone: true } },
        },
      },
    },
  });

  if (!notification) return "missing"; // e.g. the data was wiped; nothing to do
  if (notification.status !== "scheduled") return "skipped"; // already sent or cancelled

  const { booking } = notification;

  // A confirmation or reminder for a booking that is no longer active would be wrong.
  // (A cancellation email is the opposite: it is sent BECAUSE the booking is cancelled.)
  if (notification.type !== "cancellation" && !ACTIVE_STATUSES.includes(booking.status)) {
    await prisma.notification.update({ where: { id: notification.id }, data: { status: "cancelled" } });
    return "skipped";
  }

  const { subject, text } = buildEmail(notification.type, {
    customerName: booking.customer.name,
    serviceName: booking.service.name,
    staffName: booking.staff.name,
    businessName: booking.business.name,
    businessAddress: booking.business.address,
    startsAt: booking.startsAt,
    timezone: booking.business.timezone,
  });

  // If this throws, the job fails and the queue retries it with a growing delay.
  await sendEmail({ to: booking.customer.email, subject, text });

  await prisma.notification.update({ where: { id: notification.id }, data: { status: "sent", sentAt: new Date() } });
  return "sent";
}
