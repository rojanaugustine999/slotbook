import { z } from "zod";

// The part of the URL after the "?", for example:
//   /b/glow-salon/availability?serviceId=...&date=2026-12-05&staffId=...
export const availabilityQuerySchema = z.object({
  serviceId: z.string().uuid(),
  // A calendar date in the salon's timezone. No time and no offset: the salon's
  // own timezone decides which real moments that day covers.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use "YYYY-MM-DD", like "2026-12-05"'),
  // Leave out to mean "any staff member who offers this service".
  staffId: z.string().uuid().optional(),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
