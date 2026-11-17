import { IANAZone } from "luxon";
import { z } from "zod";

// ─── Reserved addresses ──────────────────────────────────────────────────────
// A salon's booking page lives at the top level of the web app: slotbook.app/glow-salon.
// The app's own pages live there too (/dashboard, /me), and the router checks those first.
// So a salon called "dashboard" could never be opened. These words are kept for the app,
// including a few it may need later, and "assets", where the built web app's files live.
// ──────────────────────────────────────────────────────────────────────────────
export const RESERVED_SLUGS = new Set([
  "dashboard", "me", "b", "api", "auth", "assets", "static", "admin", "account", "settings",
  "login", "logout", "signin", "signup", "register", "help", "about", "health", "www", "slotbook",
]);

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(100),
  // Used in the public URL: slotbook.app/glow-salon
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, numbers and single dashes only")
    .min(3)
    .max(50)
    .refine((slug) => !RESERVED_SLUGS.has(slug), "this address is used by SlotBook itself; please choose another"),
  timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), "must be an IANA timezone like Asia/Kolkata"),
  address: z.string().trim().max(300).optional(),
  minNoticeMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  maxAdvanceDays: z.number().int().min(1).max(365).optional(),
});

// PATCH: every field optional. Zod's .partial() does exactly that.
export const updateBusinessSchema = createBusinessSchema.partial();

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
