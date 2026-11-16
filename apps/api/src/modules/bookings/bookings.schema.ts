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
