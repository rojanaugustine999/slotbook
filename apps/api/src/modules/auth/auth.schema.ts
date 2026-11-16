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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
