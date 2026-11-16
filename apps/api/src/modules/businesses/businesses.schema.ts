import { IANAZone } from "luxon";
import { z } from "zod";

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(100),
  // Used in the public URL: slotbook.app/b/glow-salon
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, numbers and single dashes only")
    .min(3)
    .max(50),
  timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), "must be an IANA timezone like Asia/Kolkata"),
  address: z.string().trim().max(300).optional(),
  minNoticeMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  maxAdvanceDays: z.number().int().min(1).max(365).optional(),
});

// PATCH: every field optional. Zod's .partial() does exactly that.
export const updateBusinessSchema = createBusinessSchema.partial();

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
