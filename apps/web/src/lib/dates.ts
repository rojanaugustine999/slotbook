import { DateTime } from "luxon";

// ─── Dates and timezones ─────────────────────────────────────────────────────
// A salon works in ITS timezone. A customer's laptop may be in another one. So
// every date and time here is worked out in the SALON's timezone, never the
// browser's: "11:00" must mean 11:00 where the salon is.
// ──────────────────────────────────────────────────────────────────────────────

export interface DayOption {
  date: string; // "2026-11-23", the form the API expects
  weekday: string; // "Mon"
  day: string; // "23"
  month: string; // "Nov"
  isToday: boolean;
}

/** The next `count` calendar days in the salon's timezone, starting with today there. */
export function upcomingDays(timezone: string, count: number, now: DateTime = DateTime.now()): DayOption[] {
  const today = now.setZone(timezone).startOf("day");
  return Array.from({ length: count }, (_, i) => {
    const d = today.plus({ days: i });
    return { date: d.toFormat("yyyy-MM-dd"), weekday: d.toFormat("ccc"), day: d.toFormat("d"), month: d.toFormat("LLL"), isToday: i === 0 };
  });
}

/** "2026-11-23" + "11:00" in the salon's timezone, as the ISO moment with offset that the API wants. */
export function toStartsAt(date: string, time: string, timezone: string): string {
  const moment = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
  if (!moment.isValid) throw new Error(`Not a real date and time: ${date} ${time}`);
  return moment.toISO() ?? "";
}

/** "13:30" becomes "1:30 pm". */
export function formatClock(time: string): string {
  const parsed = DateTime.fromFormat(time, "HH:mm");
  return parsed.isValid ? parsed.toFormat("h:mm a").toLowerCase() : time;
}

/** A stored moment shown on the salon's wall clock: "Mon 23 Nov, 11:00 am". */
export function formatWhen(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toFormat("ccc d LLL, h:mm a").replace(/AM|PM/, (m) => m.toLowerCase());
}

/** "Monday 23 November" for headings. */
export function formatDayLong(date: string): string {
  return DateTime.fromISO(date).toFormat("cccc d LLLL");
}

export function isInFuture(iso: string, now: DateTime = DateTime.now()): boolean {
  return DateTime.fromISO(iso) > now;
}

export type PartOfDay = "Morning" | "Afternoon" | "Evening";

/** Groups slots so a long list is easy to scan. */
export function partOfDay(time: string): PartOfDay {
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

// ─── Week and calendar helpers ───────────────────────────────────────────────
// These work on plain "YYYY-MM-DD" dates. A calendar day has no timezone of its own, so
// adding days to it is simple date arithmetic.

/** The Monday of the week that contains `date`. */
export function startOfWeek(date: string): string {
  return DateTime.fromISO(date).startOf("week").toFormat("yyyy-MM-dd");
}

export function shiftDays(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toFormat("yyyy-MM-dd");
}

/** Today's date as it is right now in the salon's timezone. */
export function todayIn(timezone: string, now: DateTime = DateTime.now()): string {
  return now.setZone(timezone).toFormat("yyyy-MM-dd");
}

/** Minutes after local midnight, in the salon's timezone: 10:30 is 630. */
export function minutesOfDay(iso: string, timezone: string): number {
  const moment = DateTime.fromISO(iso, { zone: timezone });
  return moment.hour * 60 + moment.minute;
}

/** The calendar day a stored moment falls on IN THE SALON: "2026-11-17" for 00:30 in Kochi, even though that is still the 16th in UTC. */
export function localDate(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toFormat("yyyy-MM-dd");
}

/** "10:30 am" for a stored moment, on the salon's clock. */
export function formatTimeOf(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toFormat("h:mm a").toLowerCase();
}

/** "10:00 am to 11:00 am" */
export function formatTimeRange(startIso: string, endIso: string, timezone: string): string {
  return `${formatTimeOf(startIso, timezone)} to ${formatTimeOf(endIso, timezone)}`;
}

/** "23 to 29 Nov 2026", or "30 Nov to 6 Dec 2026" when the week crosses a month. */
export function formatWeekRange(start: string): string {
  const first = DateTime.fromISO(start);
  const last = first.plus({ days: 6 });
  if (first.year !== last.year) return `${first.toFormat("d LLL yyyy")} to ${last.toFormat("d LLL yyyy")}`;
  if (first.month !== last.month) return `${first.toFormat("d LLL")} to ${last.toFormat("d LLL yyyy")}`;
  return `${first.toFormat("d")} to ${last.toFormat("d LLL yyyy")}`;
}

/** "9 am", "12 pm", "5 pm" for the hour labels down the side of the calendar. */
export function formatHourLabel(hour: number): string {
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${hour < 12 ? "am" : "pm"}`;
}
