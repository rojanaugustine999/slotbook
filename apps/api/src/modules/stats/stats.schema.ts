import { z } from "zod";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use "YYYY-MM-DD", like "2026-12-05"');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;

// GET /businesses/:id/stats?from=2026-11-01&to=2026-11-30
// Both dates are calendar days in the SALON's timezone, and `to` is included.
export const statsQuerySchema = z
  .object({ from: localDate, to: localDate })
  .refine((q) => daysBetween(q.from, q.to) >= 0, { message: "to must not be before from", path: ["to"] })
  // A cap keeps one request from scanning years of bookings.
  .refine((q) => daysBetween(q.from, q.to) <= 92, { message: "the range can be at most 92 days", path: ["to"] });

export type StatsQuery = z.infer<typeof statsQuerySchema>;
