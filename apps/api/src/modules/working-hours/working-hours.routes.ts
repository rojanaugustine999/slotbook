import { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { setWorkingHoursSchema } from "./working-hours.schema.js";
import * as workingHours from "./working-hours.service.js";

const idParam = z.string().uuid();

export const workingHoursRouter = Router();
workingHoursRouter.use(requireAuth);

// GET /businesses/:id/staff/:staffId/working-hours  → read the weekly schedule
workingHoursRouter.get("/:id/staff/:staffId/working-hours", async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const staffId = idParam.parse(req.params.staffId);
  res.json({ hours: await workingHours.getWorkingHours(businessId, staffId, currentUserId(req)) });
});

// PUT /businesses/:id/staff/:staffId/working-hours  → replace the weekly schedule
workingHoursRouter.put("/:id/staff/:staffId/working-hours", validateBody(setWorkingHoursSchema), async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const staffId = idParam.parse(req.params.staffId);
  res.json({ hours: await workingHours.setWorkingHours(businessId, staffId, currentUserId(req), req.body) });
});
