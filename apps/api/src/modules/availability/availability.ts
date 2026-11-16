import { DateTime } from "luxon";

// ─── Availability ────────────────────────────────────────────────────────────
// Answers: "which start times can a customer book on this date?"
//
//   Working hours:   09:00 ████████████████████████████ 18:00
//   minus bookings:        ░░░░           ░░░░░░
//   minus time off:                                ░░░░░
//   = free time:     ████      ██████████       ██     ██
//
// Then we walk through the free time in steps and keep every start time where
// the whole service fits.
//
// Everything in this file is a PURE function: data in, answer out. No database,
// no "what time is it now" (the caller passes `now` in). That is why it can be
// tested so thoroughly without any setup.
// ──────────────────────────────────────────────────────────────────────────────

export interface TimeRange {
  startsAt: Date;
  endsAt: Date; // exclusive: a range ending at 11:00 does not include 11:00 itself
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

const MINUTE_MS = 60 * 1000;

// ─── HELPER 1 of 3: overlaps ─────────────────────────────────────────────────
// Do two time ranges share any time?
//
//   a:  |-----------|                a:  |------|
//   b:        |-----------|          b:         |------|
//   overlap: YES                     overlap: NO (they only touch; end is exclusive)
//
// Two ranges overlap when EACH one starts before the OTHER one ends.
// ──────────────────────────────────────────────────────────────────────────────
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

// ─── HELPER 2 of 3: subtract ─────────────────────────────────────────────────
// Removes one busy block from a list of free ranges.
//
//   free:    |----------------------|
//   block:           |------|
//   result:  |-------|      |-------|     (a piece on each side)
//
// A block in the middle splits a range in two; a block at one edge trims it;
// a block covering the whole range removes it; a block elsewhere changes nothing.
// ──────────────────────────────────────────────────────────────────────────────
export function subtract(free: TimeRange[], block: TimeRange): TimeRange[] {
  const result: TimeRange[] = [];

  for (const range of free) {
    if (!overlaps(range, block)) {
      result.push(range); // untouched by this block
      continue;
    }

    // Keep the part of the range that comes BEFORE the block, if there is one.
    if (range.startsAt < block.startsAt) {
      result.push({ startsAt: range.startsAt, endsAt: block.startsAt });
    }

    // Keep the part of the range that comes AFTER the block, if there is one.
    if (block.endsAt < range.endsAt) {
      result.push({ startsAt: block.endsAt, endsAt: range.endsAt });
    }
  }

  return result;
}

// ─── HELPER 3 of 3: toRange ──────────────────────────────────────────────────
// Turns "09:00 to 13:00 on 5 Dec 2026 in Asia/Kolkata" into two real moments.
//
// This is where a schedule (clock times, no date) meets a calendar date.
// We must build the LOCAL clock time and let Luxon find the matching moment.
// "Midnight plus 540 minutes" would be wrong on days when the clocks change:
// on such a day, 09:00 is only 8 (or 10) real hours after midnight.
// ──────────────────────────────────────────────────────────────────────────────
export function toRange(date: string, timezone: string, startMinute: number, endMinute: number): TimeRange {
  const day = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  if (!day.isValid) throw new Error(`Invalid date or timezone: ${date} ${timezone}`);

  const at = (minuteOfDay: number): Date => {
    // 1440 means "24:00", which is midnight at the start of the next day.
    if (minuteOfDay === 1440) return day.plus({ days: 1 }).toJSDate();

    return day.set({ hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 }).toJSDate();
  };

  return { startsAt: at(startMinute), endsAt: at(endMinute) };
}

/** Returns available start times as local "HH:mm" strings, e.g. ["09:00", "09:15"]. */
export function getAvailableSlots(input: AvailabilityInput): string[] {
  const stepMs = (input.stepMinutes ?? 15) * MINUTE_MS;

  // The slot must be free for the service AND its cleanup buffer.
  const neededMs = (input.service.durationMin + input.service.bufferMin) * MINUTE_MS;

  // Customers can't book in the past, or with less notice than the salon wants.
  const earliestStart = input.now.getTime() + input.minNoticeMinutes * MINUTE_MS;

  // Step 1: start with the working hours as real moments on this date.
  let free = input.workingHours.map((block) => toRange(input.date, input.timezone, block.startMinute, block.endMinute));

  // Step 2: remove everything that makes the staff member busy.
  for (const busy of [...input.timeOff, ...input.bookings]) {
    free = subtract(free, busy);
  }

  // Step 3: walk each free range in steps and keep the start times that fit.
  const starts: number[] = [];
  for (const range of free) {
    const rangeEnd = range.endsAt.getTime();

    for (let start = range.startsAt.getTime(); start + neededMs <= rangeEnd; start += stepMs) {
      if (start >= earliestStart) starts.push(start);
    }
  }

  // Step 4: sort, then show each moment as a clock time in the salon's timezone.
  return starts
    .sort((a, b) => a - b)
    .map((start) => DateTime.fromMillis(start, { zone: input.timezone }).toFormat("HH:mm"));
}
