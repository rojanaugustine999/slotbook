import { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { statsQuerySchema } from "./stats.schema.js";
import { getBusinessStats } from "./stats.service.js";

const idParam = z.string().uuid();

export const statsRouter = Router();
statsRouter.use(requireAuth);

// GET /businesses/:id/stats?from=YYYY-MM-DD&to=YYYY-MM-DD  (owner only)
statsRouter.get("/:id/stats", async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const query = statsQuerySchema.parse(req.query);
  res.json({ stats: await getBusinessStats(businessId, currentUserId(req), query) });
});
