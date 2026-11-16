import { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { createTimeOffSchema } from "./time-off.schema.js";
import * as timeOff from "./time-off.service.js";

const idParam = z.string().uuid();

export const timeOffRouter = Router();
timeOffRouter.use(requireAuth);

// POST /businesses/:id/staff/:staffId/time-off  → add leave or a holiday
timeOffRouter.post("/:id/staff/:staffId/time-off", validateBody(createTimeOffSchema), async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const staffId = idParam.parse(req.params.staffId);
  const created = await timeOff.createTimeOff(businessId, staffId, currentUserId(req), req.body);
  res.status(201).json({ timeOff: created });
});

// GET /businesses/:id/staff/:staffId/time-off  → upcoming time off, soonest first
timeOffRouter.get("/:id/staff/:staffId/time-off", async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const staffId = idParam.parse(req.params.staffId);
  res.json({ timeOff: await timeOff.listUpcomingTimeOff(businessId, staffId, currentUserId(req)) });
});

// DELETE /businesses/:id/staff/:staffId/time-off/:timeOffId  → cancel time off
timeOffRouter.delete("/:id/staff/:staffId/time-off/:timeOffId", async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const staffId = idParam.parse(req.params.staffId);
  const timeOffId = idParam.parse(req.params.timeOffId);
  await timeOff.deleteTimeOff(businessId, staffId, timeOffId, currentUserId(req));
  res.status(204).end();
});
