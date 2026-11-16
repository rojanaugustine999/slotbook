import { z } from "zod";

// ─── How working hours are stored ────────────────────────────────────────────
// The API speaks in clock times a human reads:      "09:00" to "13:00"
// The database stores minutes after local midnight:  540    to  780
// Minutes are easy to compare and add; clock text is easy to read. We convert at the edge.
// ──────────────────────────────────────────────────────────────────────────────

/** "09:30" → 570 */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/** 570 → "09:30" */
export function toClock(totalMinutes: number): string {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// "00:00" to "23:59". The end of a block may also be "24:00" (midnight at the end of the day).
const startTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use 24-hour "HH:mm", like "09:00"');
const endTime = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'use 24-hour "HH:mm", like "18:00"');

const block = z
  .object({
    weekday: z.number().int().min(1).max(7), // 1 = Monday ... 7 = Sunday
    start: startTime,
    end: endTime,
  })
  // A rule that compares two fields has to run on the whole object.
  .refine((b) => toMinutes(b.end) > toMinutes(b.start), { message: "end must be after start", path: ["end"] });

export const setWorkingHoursSchema = z.object({
  // The staff member's whole week. Several blocks on one day make a split shift
  // (for example 09:00–13:00 and 14:00–18:00, with lunch in between).
  hours: z
    .array(block)
    .max(28)
    .superRefine((blocks, ctx) => {
      // Two blocks on the same day must not overlap, or availability would count that time twice.
      for (let weekday = 1; weekday <= 7; weekday++) {
        const sameDay = blocks
          .filter((b) => b.weekday === weekday)
          .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

        for (let i = 1; i < sameDay.length; i++) {
          // After sorting, a block overlaps the one before it if it starts before that one ends.
          if (toMinutes(sameDay[i]!.start) < toMinutes(sameDay[i - 1]!.end)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `blocks overlap on weekday ${weekday}` });
          }
        }
      }
    }),
});

export type SetWorkingHoursInput = z.infer<typeof setWorkingHoursSchema>;
