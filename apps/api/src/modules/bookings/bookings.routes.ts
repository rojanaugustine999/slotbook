import { Router } from "express";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { createBookingSchema } from "./bookings.schema.js";
import * as bookings from "./bookings.service.js";

// ── Mounted at /b ──────────────────────────────────────────────────────────
export const bookingsRouter = Router();

// POST /b/:slug/bookings  → book a slot (login needed)
// requireAuth sits on this one route, not on the whole router, because the
// other /b routes (salon page, availability) must stay open to everyone.
bookingsRouter.post("/:slug/bookings", requireAuth, validateBody(createBookingSchema), async (req, res) => {
  const slug = String(req.params.slug); // the salon's name in the URL
  const booking = await bookings.createBooking(slug, currentUserId(req), req.body);
  res.status(201).json({ booking });
});

// ── Mounted at /me ─────────────────────────────────────────────────────────
export const meRouter = Router();
meRouter.use(requireAuth);

// GET /me/bookings  → the logged-in customer's own bookings
meRouter.get("/bookings", async (req, res) => {
  res.json({ bookings: await bookings.listMyBookings(currentUserId(req)) });
});
