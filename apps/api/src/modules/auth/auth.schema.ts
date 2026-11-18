import { z } from "zod";

// A phone as people type it: digits, spaces, dashes, brackets, an optional leading +.
// REQUIRED: salons need a way to reach the people who book with them. An empty box is
// "missing", not "no phone". Shared by sign-up and the Account page, so both accept
// exactly the same numbers.
// (The database column stays optional: accounts made before this rule may have no phone,
// and they're nudged to add one on My bookings rather than given a made-up number.)
const phone = z.preprocess(
  (value) => (value === undefined || value === null ? "" : value),
  z
    .string()
    .trim()
    .min(1, { message: "enter your phone number", abort: true }) // empty: just this message, not "use digits" too
    .regex(/^\+?[0-9 ()-]{6,20}$/, "use digits, like +91 98765 43210"),
);

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // bcrypt only uses the first 72 bytes of a password, so cap it there.
  password: z.string().min(8, "at least 8 characters").max(72),
  name: z.string().trim().min(1).max(100),
  phone,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// Your own details. Email is deliberately NOT here: changing it safely needs a confirmation
// link sent to the new address, and SlotBook doesn't send real emails.
// The phone can be changed but not removed. Leave it out to keep the current one (which is
// how someone without a phone yet saves just a new name).
export const updateMeSchema = z
  .object({ name: z.string().trim().min(1).max(100).optional(), phone: phone.optional() })
  .refine((input) => input.name !== undefined || input.phone !== undefined, "send a name or a phone");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: registerSchema.shape.password, // the same rules as when signing up
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
