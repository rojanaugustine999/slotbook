import { DateTime } from "luxon";

// ─── Date ranges for the stats page ──────────────────────────────────────────
// A range is two plain calendar days, "from" and "to", both included, in the salon's
// timezone. The API accepts at most 92 days at once.
// ──────────────────────────────────────────────────────────────────────────────

export const MAX_RANGE_DAYS = 92;

export type PresetId = "7d" | "30d" | "this-month" | "last-month";

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
];

const iso = (date: DateTime) => date.toFormat("yyyy-MM-dd");

export function presetRange(id: PresetId, today: string): { from: string; to: string } {
  const now = DateTime.fromISO(today);
  switch (id) {
    case "7d":
      return { from: iso(now.minus({ days: 6 })), to: today }; // today and the 6 days before it
    case "30d":
      return { from: iso(now.minus({ days: 29 })), to: today };
    case "this-month":
      return { from: iso(now.startOf("month")), to: today }; // the month so far
    case "last-month": {
      const previous = now.minus({ months: 1 });
      return { from: iso(previous.startOf("month")), to: iso(previous.endOf("month")) };
    }
  }
}

/** How many days the range covers, counting both ends: 1 June to 7 June is 7. */
export function rangeDays(from: string, to: string): number {
  return Math.round(DateTime.fromISO(to).diff(DateTime.fromISO(from), "days").days) + 1;
}

/** A sentence for what is wrong with a range, or null when it is fine. */
export function validateRange(from: string, to: string): string | null {
  const start = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  if (!start.isValid || !end.isValid) return "Choose a start and an end date.";
  if (end < start) return "The end date can't be before the start date.";
  if (rangeDays(from, to) > MAX_RANGE_DAYS) return `Choose at most ${MAX_RANGE_DAYS} days at a time.`;
  return null;
}

/** Which preset a range is, if it is exactly one of them. */
export function matchPreset(from: string, to: string, today: string): PresetId | null {
  return PRESETS.find((p) => {
    const range = presetRange(p.id, today);
    return range.from === from && range.to === to;
  })?.id ?? null;
}

/** "16 Oct to 14 Nov 2026", with the year on both ends when the range crosses New Year. */
export function formatRange(from: string, to: string): string {
  const start = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  if (start.year !== end.year) return `${start.toFormat("d LLL yyyy")} to ${end.toFormat("d LLL yyyy")}`;
  return `${start.toFormat("d LLL")} to ${end.toFormat("d LLL yyyy")}`;
}
