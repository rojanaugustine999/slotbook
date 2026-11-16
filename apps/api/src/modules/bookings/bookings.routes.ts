import { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { changeStatusSchema, createBookingSchema, ownerBookingsQuerySchema, rescheduleBookingSchema } from "./bookings.schema.js";
import * as bookings from "./bookings.service.js";

const idParam = z.string().uuid();

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

// ── Mounted at /me: the logged-in customer's own bookings ──────────────────
export const meRouter = Router();
meRouter.use(requireAuth);

// GET /me/bookings  → list my bookings
meRouter.get("/bookings", async (req, res) => {
  res.json({ bookings: await bookings.listMyBookings(currentUserId(req)) });
});

// POST /me/bookings/:bookingId/cancel
// An action like "cancel" is a POST to its own URL. The booking isn't deleted:
// it stays in the history with status "cancelled".
meRouter.post("/bookings/:bookingId/cancel", async (req, res) => {
  const bookingId = idParam.parse(req.params.bookingId);
  res.json({ booking: await bookings.cancelMyBooking(currentUserId(req), bookingId) });
});

// POST /me/bookings/:bookingId/reschedule  { startsAt, staffId? }
meRouter.post("/bookings/:bookingId/reschedule", validateBody(rescheduleBookingSchema), async (req, res) => {
  const bookingId = idParam.parse(req.params.bookingId);
  res.json({ booking: await bookings.rescheduleMyBooking(currentUserId(req), bookingId, req.body) });
});

// ── Mounted at /businesses: the owner's view ───────────────────────────────
export const ownerBookingsRouter = Router();
ownerBookingsRouter.use(requireAuth);

// GET /businesses/:id/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD&staffId=&status=
ownerBookingsRouter.get("/:id/bookings", async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const query = ownerBookingsQuerySchema.parse(req.query);
  res.json({ bookings: await bookings.listBusinessBookings(businessId, currentUserId(req), query) });
});

// GET /businesses/:id/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&staffId=&status=
// Same filters as the list, but grouped by day (every day included) for a calendar grid.
ownerBookingsRouter.get("/:id/calendar", async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const query = ownerBookingsQuerySchema.parse(req.query);
  res.json({ calendar: await bookings.getCalendar(businessId, currentUserId(req), query) });
});

// PATCH /businesses/:id/bookings/:bookingId/status  { status }
ownerBookingsRouter.patch("/:id/bookings/:bookingId/status", validateBody(changeStatusSchema), async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const bookingId = idParam.parse(req.params.bookingId);
  const booking = await bookings.changeBookingStatus(businessId, bookingId, currentUserId(req), req.body.status);
  res.json({ booking });
});
