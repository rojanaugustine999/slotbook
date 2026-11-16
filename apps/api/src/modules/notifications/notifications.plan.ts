import type { NotificationType } from "@prisma/client";

export interface PlannedNotification {
  type: NotificationType;
  sendAt: Date;
}

const HOUR_MS = 60 * 60 * 1000;

// Decides WHICH notifications a booking needs and WHEN each should go out.
// Pure function (no database, no clock): `now` is passed in, like in availability.
//
//   booked now ──► confirmation (immediately)
//   start − 24h ─► reminder_24h   (skipped if that moment has already passed)
//   start − 1h ──► reminder_1h    (skipped if that moment has already passed)
//
// A booking made 3 hours ahead gets a confirmation and the 1-hour reminder, but
// no 24-hour reminder, because sending one "in the past" makes no sense.
export function planNotifications(startsAt: Date, now: Date): PlannedNotification[] {
  const planned: PlannedNotification[] = [{ type: "confirmation", sendAt: now }];

  const dayBefore = new Date(startsAt.getTime() - 24 * HOUR_MS);
  if (dayBefore > now) planned.push({ type: "reminder_24h", sendAt: dayBefore });

  const hourBefore = new Date(startsAt.getTime() - HOUR_MS);
  if (hourBefore > now) planned.push({ type: "reminder_1h", sendAt: hourBefore });

  return planned;
}
