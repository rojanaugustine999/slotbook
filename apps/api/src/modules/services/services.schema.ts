import { z } from "zod";

export const createServiceSchema = z.object({
  // Text, spaces trimmed from the ends, 2 to 100 characters
  name: z.string().trim().min(2).max(100),

    // How long the service takes, in minutes (5 min to 8 hours)
  durationMin: z.number().int().min(5).max(480),

  // Cleanup time after the service, in minutes. Optional.
   bufferMin: z.number().int().min(0).max(120).optional(),

  // Price in paise (50000 = ₹500). Can't be negative.
    priceCents: z.number().int().min(0),

});

// For editing a service: same rules, but every field is optional,
// so you can change just the price without resending the name.
// Editing can also bring a hidden service back ({ "active": true }). Hiding stays on
// DELETE, which reads better in the routes; both just flip the same column.
export const updateServiceSchema = createServiceSchema.partial().extend({
  active: z.boolean().optional(),
});

// TypeScript types made from the schemas, used by the service file next.
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;