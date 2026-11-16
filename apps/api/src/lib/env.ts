import { z } from "zod";

// Validate environment variables once, at startup.
// If something is missing, the server refuses to start with a clear message
// instead of crashing later in some random request.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Job queue (reminders). Local Docker Redis by default.
  REDIS_URL: z.string().default("redis://localhost:6379"),
  QUEUE_PREFIX: z.string().default("slotbook"),

  // Email. With no key, emails are printed to the console instead of sent,
  // so you can build and test everything without an email account.
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("SlotBook <onboarding@resend.dev>"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  console.error("Copy apps/api/.env.example to apps/api/.env and fill it in.");
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
