import { Router } from "express";
import { availabilityQuerySchema } from "./availability.schema.js";
import { getPublicAvailability } from "./availability.service.js";

// Public: no login needed. Customers must be able to see open slots before they sign up.
export const availabilityRouter = Router();

// GET /b/:slug/availability?serviceId=...&date=YYYY-MM-DD&staffId=...
availabilityRouter.get("/:slug/availability", async (req, res) => {
  // req.query holds the values after the "?" in the URL. It is checked like a body.
  const query = availabilityQuerySchema.parse(req.query);
  res.json(await getPublicAvailability(req.params.slug, query));
});
