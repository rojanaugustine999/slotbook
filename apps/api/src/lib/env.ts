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

  // Logging: "silent" turns it off (the tests do this).
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Rate limiting. Turn off only for tests.
  RATE_LIMIT_ENABLED: z.enum(["true", "false"]).default("true"),
  // How many reverse proxies (Render, Nginx, ...) sit in front of the API. With 0,
  // req.ip is the direct connection. With 1, it is the real visitor taken from the
  // proxy's X-Forwarded-For header. Set it wrong and rate limits break (see app.ts).
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Job queue (reminders). Local Docker Redis by default.
  REDIS_URL: z.string().default("redis://localhost:6379"),
  QUEUE_PREFIX: z.string().default("slotbook"),

  // Email. With no key, emails are printed to the console instead of sent,
  // so you can build and test everything without an email account.
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("SlotBook <onboarding@resend.dev>"),

  // Razorpay (deposits). Without both, salons can't take deposits and booking works as
  // before. The key id is public (the browser needs it); the secret must never leave the server.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  // Set in the Razorpay dashboard when adding the webhook. Without it, webhooks are refused.
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  console.error("Copy apps/api/.env.example to apps/api/.env and fill it in.");
  process.exit(1);
}

// A deployed API must never run with the placeholder secret copied from .env.example:
// anyone who has read this repository would know it and could forge login tokens.
if (parsed.data.NODE_ENV === "production" && /change-me/i.test(parsed.data.JWT_ACCESS_SECRET)) {
  console.error("JWT_ACCESS_SECRET is still the placeholder from .env.example. Generate a real one:");
  console.error("  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"");
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
