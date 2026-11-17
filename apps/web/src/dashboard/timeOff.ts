import { DateTime } from "luxon";

// ─── Time off: wall-clock in, exact moments out ──────────────────────────────
// Working hours are "every Monday 9 to 6". Time off is a real stretch of time:
// "from 5 Dec 00:00 to 8 Dec 00:00 in Kochi". The owner types dates (and maybe times)
// as they appear on the salon's wall clock; we turn them into exact moments with the
// salon's timezone, so it means the same thing wherever the owner's laptop happens to be.
// "Whole days" ends at midnight AFTER the last day, so "5 to 7 Dec" includes all of the 7th.
// ──────────────────────────────────────────────────────────────────────────────

export interface TimeOffForm {
  fromDate: string; // "2026-12-05"
  untilDate: string; // "2026-12-07"
  wholeDays: boolean;
  fromTime: string; // "14:00", used when not whole days
  untilTime: string;
}

export function timeOffMoments(form: TimeOffForm, timezone: string): { startsAt: string; endsAt: string } | { problem: string } {
  if (!form.fromDate || !form.untilDate) return { problem: "Choose the first and last day." };

  const start = DateTime.fromISO(`${form.fromDate}T${form.wholeDays ? "00:00" : form.fromTime}`, { zone: timezone });
  const end = form.wholeDays
    ? DateTime.fromISO(form.untilDate, { zone: timezone }).plus({ days: 1 }).startOf("day")
    : DateTime.fromISO(`${form.untilDate}T${form.untilTime}`, { zone: timezone });

  if (!start.isValid || !end.isValid) return { problem: "Enter real dates and times." };
  if (end <= start) return { problem: form.wholeDays ? "The last day can't be before the first." : "The end must be after the start." };
  return { startsAt: start.toISO()!, endsAt: end.toISO()! };
}

/** "Fri 5 Dec – Sun 7 Dec", "Fri 5 Dec", or "Fri 5 Dec, 2:00 pm – 6:00 pm", on the salon's clock. */
export function formatTimeOff(startsAt: string, endsAt: string, timezone: string): string {
  const start = DateTime.fromISO(startsAt, { zone: timezone });
  const end = DateTime.fromISO(endsAt, { zone: timezone });
  const day = (d: DateTime) => d.toFormat("ccc d LLL");
  const time = (d: DateTime) => d.toFormat("h:mm a").toLowerCase();

  const midnight = (d: DateTime) => d.hour === 0 && d.minute === 0;
  if (midnight(start) && midnight(end)) {
    const lastDay = end.minus({ days: 1 });
    return lastDay.hasSame(start, "day") ? day(start) : `${day(start)} – ${day(lastDay)}`;
  }
  if (start.hasSame(end, "day")) return `${day(start)}, ${time(start)} – ${time(end)}`;
  return `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}
