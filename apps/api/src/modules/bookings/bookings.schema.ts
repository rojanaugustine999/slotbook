import { z } from "zod";

export const createBookingSchema = z.object({
  serviceId: z.string().uuid(),
  // Leave out to mean "any staff member who is free at that time".
  staffId: z.string().uuid().optional(),
  // A real moment, so it must carry a timezone offset (same rule as time off).
  startsAt: z.string().datetime({ offset: true, message: 'use ISO time with an offset, like "2026-12-05T09:00:00+05:30"' }),
  notes: z.string().trim().max(500).optional(),
});

// Notice what is NOT in this schema:
//   endsAt      the server works it out from the service's length, so a customer
//               can't book a 90-minute service into a 10-minute gap
//   customerId  comes from the login token, so you can't book as someone else
//   status      the server decides it
//   price       read from the service, never trusted from the client

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// Moving a booking: a new start time, and optionally a different staff member.
export const rescheduleBookingSchema = createBookingSchema.pick({ startsAt: true, staffId: true });
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;

// ── Owner side ──────────────────────────────────────────────────────────────

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use "YYYY-MM-DD", like "2026-12-05"');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;

// GET /businesses/:id/bookings?from=2026-12-01&to=2026-12-07&staffId=...&status=confirmed
export const ownerBookingsQuerySchema = z
  .object({
    from: localDate,
    to: localDate, // included: from=to means "just that one day"
    staffId: z.string().uuid().optional(),
    status: z.enum(["pending", "confirmed", "cancelled", "completed", "no_show"]).optional(),
  })
  .refine((q) => daysBetween(q.from, q.to) >= 0, { message: "to must not be before from", path: ["to"] })
  // A cap keeps one request from loading years of bookings at once.
  .refine((q) => daysBetween(q.from, q.to) <= 31, { message: "the range can be at most 31 days", path: ["to"] });

export type OwnerBookingsQuery = z.infer<typeof ownerBookingsQuerySchema>;

// Owners can record what happened, or cancel. They can't set "pending" or "confirmed".
export const changeStatusSchema = z.object({
  status: z.enum(["cancelled", "completed", "no_show"]),
});
