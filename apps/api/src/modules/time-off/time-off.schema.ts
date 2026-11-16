import { z } from "zod";

// ─── Moments in time ─────────────────────────────────────────────────────────
// Working hours were clock times with no date ("09:00 every Monday").
// Time off is different: it is a real moment ("5 December 2026 at 09:00 in Kochi").
//
// A real moment must say which timezone it means, so we only accept ISO text
// that ends with an offset:
//   "2026-12-05T09:00:00+05:30"   OK: 9 AM in India
//   "2026-12-05T03:30:00Z"        OK: the same moment, written in UTC
//   "2026-12-05T09:00:00"         REJECTED: 9 AM where? Nobody can know.
// The database then stores every moment in UTC.
// ──────────────────────────────────────────────────────────────────────────────
const moment = z.string().datetime({ offset: true, message: 'use ISO time with an offset, like "2026-12-05T09:00:00+05:30"' });

const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000;

export const createTimeOffSchema = z
  .object({
    startsAt: moment,
    endsAt: moment,
    reason: z.string().trim().max(200).optional(), // e.g. "Annual leave"
  })
  .refine((t) => new Date(t.endsAt) > new Date(t.startsAt), { message: "endsAt must be after startsAt", path: ["endsAt"] })
  // A typo like year 2206 would block a staff member for centuries, so cap the length.
  .refine((t) => new Date(t.endsAt).getTime() - new Date(t.startsAt).getTime() <= ONE_YEAR_MS, {
    message: "time off can't be longer than one year",
    path: ["endsAt"],
  });

export type CreateTimeOffInput = z.infer<typeof createTimeOffSchema>;
