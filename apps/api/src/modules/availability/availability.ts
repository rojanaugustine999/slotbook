// ─── WEEK 4: YOU write this function ─────────────────────────────────────────
// It is a PURE function: data in, slots out. No database, no Date.now().
// That's why it's easy to test: the route loads the data from Prisma and passes it in.
//
// Suggested steps:
//  1. Turn each working-hours block (local minutes) into a real UTC interval for `date`
//     in `timezone`. Build the LOCAL wall-clock time, then let Luxon find the UTC moment:
//       DateTime.fromISO(date, { zone: timezone })
//         .set({ hour: Math.floor(540 / 60), minute: 540 % 60 })   // 09:00 local
//         .toJSDate()
//     Don't use "midnight + 540 minutes": on daylight-saving days that lands on the wrong hour.
//  2. Subtract every timeOff and booking interval from the free intervals.
//  3. Walk each free interval in `stepMinutes` steps. Start time t is valid when
//     [t, t + durationMin + bufferMin) fits entirely inside the free interval.
//  4. Drop any t earlier than now + minNoticeMinutes.
//  5. Return the start times as local "HH:mm" strings, sorted.
//
// Helpers worth writing (and testing) first:
//   overlaps(a, b), subtract(intervals, block), toLocalInterval(date, tz, startMin, endMin)
// ──────────────────────────────────────────────────────────────────────────────

export interface TimeRange {
  startsAt: Date;
  endsAt: Date; // exclusive
}

export interface AvailabilityInput {
  /** Calendar date in the business's timezone, "YYYY-MM-DD" */
  date: string;
  /** IANA timezone of the business, e.g. "Asia/Kolkata" */
  timezone: string;
  /** Current time, passed in so tests are repeatable */
  now: Date;
  service: { durationMin: number; bufferMin: number };
  /** That weekday's working blocks, in local minutes after midnight (540 = 09:00) */
  workingHours: { startMinute: number; endMinute: number }[];
  timeOff: TimeRange[];
  /** Existing pending/confirmed bookings for this staff member (endsAt already includes their buffer) */
  bookings: TimeRange[];
  minNoticeMinutes: number;
  /** Gap between offered start times. Default 15. */
  stepMinutes?: number;
}

/** Returns available start times as local "HH:mm" strings, e.g. ["09:00", "09:15"]. */
export function getAvailableSlots(_input: AvailabilityInput): string[] {
  throw new Error("Not implemented yet: this is your Week 4 task");
}
