import { formatClock } from "../lib/dates";

// ─── Weekly hours, as the editor sees them ───────────────────────────────────
// The API speaks in a flat list:   [{ weekday: 1, start: "09:00", end: "13:00" }, ...]
// The editor wants it per day:     { 1: [{ start, end }, ...], 2: [], ... 7: [] }
// A day with no blocks is closed. Two blocks on one day are a split shift, like
// 09:00–13:00 and 14:00–18:00 with lunch in between. All times are the salon's local
// wall-clock time; the API stores them as minutes after midnight.
// ──────────────────────────────────────────────────────────────────────────────

export interface HoursBlock {
  weekday: number; // 1 = Monday ... 7 = Sunday
  start: string; // "09:00"
  end: string; // "18:00", or "24:00" for midnight at the end of the day
}

export interface TimeRange {
  start: string;
  end: string;
}

export type Week = Record<number, TimeRange[]>;

export const WEEKDAYS = [
  { weekday: 1, short: "Mon", long: "Monday" },
  { weekday: 2, short: "Tue", long: "Tuesday" },
  { weekday: 3, short: "Wed", long: "Wednesday" },
  { weekday: 4, short: "Thu", long: "Thursday" },
  { weekday: 5, short: "Fri", long: "Friday" },
  { weekday: 6, short: "Sat", long: "Saturday" },
  { weekday: 7, short: "Sun", long: "Sunday" },
];

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

export function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function emptyWeek(): Week {
  return Object.fromEntries(WEEKDAYS.map((d) => [d.weekday, []]));
}

/** API list → per-day, each day sorted by start time. */
export function toWeek(blocks: HoursBlock[]): Week {
  const week = emptyWeek();
  for (const b of blocks) week[b.weekday]!.push({ start: b.start, end: b.end });
  for (const day of WEEKDAYS) week[day.weekday]!.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  return week;
}

/** Per-day → the flat list the API's PUT expects. */
export function fromWeek(week: Week): HoursBlock[] {
  return WEEKDAYS.flatMap((d) => (week[d.weekday] ?? []).map((r) => ({ weekday: d.weekday, start: r.start, end: r.end })));
}

/** What's wrong with one day's times, or null. Same rules the API checks. */
export function dayProblem(ranges: TimeRange[]): string | null {
  const sorted = [...ranges].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (const r of sorted) {
    if (toMinutes(r.end) <= toMinutes(r.start)) return "Each closing time must be after its opening time.";
  }
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i]!.start) < toMinutes(sorted[i - 1]!.end)) return "These times overlap. Start the second one after the first ends.";
  }
  return null;
}

/** A sensible first block for a day that was closed. */
export const DEFAULT_RANGE: TimeRange = { start: "09:00", end: "18:00" };

/** The next block after the day's last one: an hour's gap (say, lunch), then up to 4 hours. Null if the day is full. */
export function nextRange(ranges: TimeRange[]): TimeRange | null {
  if (ranges.length === 0) return DEFAULT_RANGE;
  const lastEnd = Math.max(...ranges.map((r) => toMinutes(r.end)));
  const start = lastEnd + 60;
  if (start >= 24 * 60) return null;
  return { start: toClock(start), end: toClock(Math.min(start + 4 * 60, 24 * 60)) };
}

/** Every 15 minutes. Starts run 00:00–23:45; ends run 00:15–24:00. */
export function timeOptions(kind: "start" | "end"): string[] {
  const first = kind === "start" ? 0 : 15;
  const last = kind === "start" ? 24 * 60 - 15 : 24 * 60;
  const out: string[] = [];
  for (let m = first; m <= last; m += 15) out.push(toClock(m));
  return out;
}

/** "09:00" → "9:00 am"; "24:00" → "midnight". */
export function timeLabel(time: string): string {
  return time === "24:00" ? "midnight" : formatClock(time);
}

/** "Mon–Fri 9:00 am–6:00 pm, Sat 10:00 am–2:00 pm": a one-line summary for the staff list. */
export function summarizeWeek(week: Week): string {
  const key = (d: number) => (week[d] ?? []).map((r) => `${timeLabel(r.start)}–${timeLabel(r.end)}`).join(", ");
  const parts: string[] = [];
  let i = 0;
  while (i < WEEKDAYS.length) {
    const day = WEEKDAYS[i]!;
    const text = key(day.weekday);
    let j = i;
    // Group neighbouring days with exactly the same hours: Mon, Tue, Wed → Mon–Wed.
    while (j + 1 < WEEKDAYS.length && key(WEEKDAYS[j + 1]!.weekday) === text) j++;
    if (text) parts.push(`${day.short}${j > i ? `–${WEEKDAYS[j]!.short}` : ""} ${text}`);
    i = j + 1;
  }
  return parts.length > 0 ? parts.join(" · ") : "No hours set";
}
