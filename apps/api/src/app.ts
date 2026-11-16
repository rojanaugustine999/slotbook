import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./lib/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { businessesRouter, publicRouter } from "./modules/businesses/businesses.routes.js";
import { servicesRouter } from "./modules/services/services.routes.js";
import { staffRouter } from "./modules/staff/staff.routes.js";
import { workingHoursRouter } from "./modules/working-hours/working-hours.routes.js";

// Builds the app without starting it, so tests can call it with supertest.
export function createApp() {
  const app = express();

  app.use(helmet()); // sensible security headers
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true })); // credentials: allow the refresh cookie
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", authRouter);
  app.use("/businesses", businessesRouter);
  app.use("/businesses", servicesRouter); // adds /businesses/:id/services
  app.use("/businesses", staffRouter); // adds /businesses/:id/staff
  app.use("/businesses", workingHoursRouter); // adds /businesses/:id/staff/:staffId/working-hours
  app.use("/b", publicRouter);

  // Order matters: these two must come after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
