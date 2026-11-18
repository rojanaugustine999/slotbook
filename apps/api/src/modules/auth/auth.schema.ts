import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // bcrypt only uses the first 72 bytes of a password, so cap it there.
  password: z.string().min(8, "at least 8 characters").max(72),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(20).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// A phone as people type it: digits, spaces, dashes, brackets, an optional leading +.
// An empty box means "no phone" (null), so a number can be removed again.
const phone = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,20}$/, "use digits, like +91 98765 43210")
    .nullable(),
);

// Your own details. Email is deliberately NOT here: changing it safely needs a confirmation
// link sent to the new address, and SlotBook doesn't send real emails.
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
