import { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { createBusinessSchema, publicListQuerySchema, updateBusinessSchema } from "./businesses.schema.js";
import * as businesses from "./businesses.service.js";

// A malformed UUID would make Postgres throw, so reject it early with a clean 400.
const idParam = z.string().uuid();

// ── Owner routes: /businesses ──────────────────────────────────────────────
export const businessesRouter = Router();
businessesRouter.use(requireAuth);

businessesRouter.post("/", validateBody(createBusinessSchema), async (req, res) => {
  res.status(201).json({ business: await businesses.createBusiness(currentUserId(req), req.body) });
});

businessesRouter.get("/mine", async (req, res) => {
  res.json({ businesses: await businesses.listMyBusinesses(currentUserId(req)) });
});

businessesRouter.get("/:id", async (req, res) => {
  const business = await businesses.getOwnedBusiness(idParam.parse(req.params.id), currentUserId(req));
  res.json({ business });
});

businessesRouter.patch("/:id", validateBody(updateBusinessSchema), async (req, res) => {
  const business = await businesses.updateBusiness(idParam.parse(req.params.id), currentUserId(req), req.body);
  res.json({ business });
});

// TODO Week 1: add services CRUD here, e.g. POST /businesses/:id/services
//   (copy this file's pattern: schema → service with getOwnedBusiness → route)

// ── Public routes: /b ──────────────────────────────────────────────────────
export const publicRouter = Router();

// GET /b?q=hair  → the salons that are ready to take bookings, for the home page (q is optional)
publicRouter.get("/", async (req, res) => {
  const { q } = publicListQuerySchema.parse(req.query);
  res.json({ businesses: await businesses.listPublicBusinesses(q) });
});

publicRouter.get("/:slug", async (req, res) => {
  res.json({ business: await businesses.getPublicBusiness(req.params.slug) });
});

// TODO Week 5: POST /b/:slug/bookings
