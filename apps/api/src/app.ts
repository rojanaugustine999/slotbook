import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Request } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { env } from "./lib/env.js";
import { logger as defaultLogger } from "./lib/logger.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { limiters } from "./middleware/rateLimit.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { availabilityRouter } from "./modules/availability/availability.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { bookingsRouter, meRouter, ownerBookingsRouter } from "./modules/bookings/bookings.routes.js";
import { businessesRouter, publicRouter } from "./modules/businesses/businesses.routes.js";
import { ownerPaymentsRouter, webhooksRouter } from "./modules/payments/payments.routes.js";
import { servicesRouter } from "./modules/services/services.routes.js";
import { statsRouter } from "./modules/stats/stats.routes.js";
import { staffRouter } from "./modules/staff/staff.routes.js";
import { timeOffRouter } from "./modules/time-off/time-off.routes.js";
import { workingHoursRouter } from "./modules/working-hours/working-hours.routes.js";

export interface AppOptions {
  /** Where request logs go. Tests pass their own so they can read the output. */
  logger?: Logger;
  /** Turn rate limiting on or off. Default: the RATE_LIMIT_ENABLED setting. */
  rateLimiting?: boolean;
}

// Builds the app without starting it, so tests can call it with supertest.
export function createApp(options: AppOptions = {}) {
  const app = express();
  const rateLimiting = options.rateLimiting ?? env.RATE_LIMIT_ENABLED === "true";

  // Behind a reverse proxy (Render, Nginx, ...) every request arrives from the PROXY's
  // address, so without this the rate limiter would treat all visitors as one person.
  // With it, Express reads the real visitor from the proxy's X-Forwarded-For header.
  // Set the number to exactly how many proxies you have: trusting more than that lets
  // anyone fake their IP by sending their own X-Forwarded-For and dodge the limits.
  if (env.TRUST_PROXY > 0) app.set("trust proxy", env.TRUST_PROXY);

  // First in line, so every request is logged, including ones the limiter rejects.
  app.use(
    pinoHttp({
      logger: options.logger ?? defaultLogger,

      // Every request gets an id, sent back as the X-Request-Id header and stamped on
      // every log line about it. When a user reports "it failed at 3pm", the id from
      // their response finds the exact log lines. We reuse an id the caller sent only
      // if it is plain letters, digits, dashes: anything else could be used to forge log lines.
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },

      // Uptime monitors call /health every few seconds: logging it would drown the real traffic.
      autoLogging: { ignore: (req) => req.url === "/health" },

      // Level by outcome, so "show me only problems" works: 5xx = error, 4xx = warn, else info.
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),

      // Log only what is useful and safe. By default pino logs ALL request headers, which
      // would put every login token in the logs. We pick the fields, and drop the query
      // string from the URL (links sometimes carry secrets there).
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split("?")[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },

      // Added to the line when the response finishes, by which time requireAuth has run.
      customProps: (req) => ({ userId: (req as Request).user?.id }),
    }),
  );

  app.use(helmet()); // sensible security headers
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true, exposedHeaders: ["X-Request-Id", "Retry-After"] })); // credentials: allow the refresh cookie

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Razorpay's webhooks: before the rate limits (all of Razorpay's calls come from a few
  // addresses, and a limited payment notice would be lost) and before express.json(),
  // because the signature has to be checked against the raw body.
  app.use("/webhooks", webhooksRouter);

  // Rate limits come BEFORE body parsing and routes, so a blocked request costs almost nothing.
  if (rateLimiting) {
    app.use(limiters.global);
    app.use("/auth/login", limiters.auth);
    app.use("/auth/register", limiters.auth);
    app.use("/b/:slug/availability", limiters.availability);
    // The booking limit counts per user, so it needs to know who the user is first.
    app.post("/b/:slug/bookings", requireAuth, limiters.booking);
  }

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.use("/auth", authRouter);
  app.use("/businesses", businessesRouter);
  app.use("/businesses", servicesRouter); // adds /businesses/:id/services
  app.use("/businesses", staffRouter); // adds /businesses/:id/staff
  app.use("/businesses", workingHoursRouter); // adds /businesses/:id/staff/:staffId/working-hours
  app.use("/businesses", ownerBookingsRouter); // adds /businesses/:id/bookings
  app.use("/businesses", statsRouter); // adds /businesses/:id/stats
  app.use("/businesses", timeOffRouter); // adds /businesses/:id/staff/:staffId/time-off
  app.use("/businesses", ownerPaymentsRouter); // adds /businesses/:id/payments
  app.use("/b", publicRouter);
  app.use("/b", availabilityRouter); // adds /b/:slug/availability
  app.use("/b", bookingsRouter); // adds /b/:slug/bookings
  app.use("/me", meRouter); // adds /me/bookings
  app.use("/admin", adminRouter); // SlotBook staff only (platform admins)

  // Order matters: these two must come after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
