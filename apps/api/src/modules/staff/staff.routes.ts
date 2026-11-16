import { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { createStaffSchema, setStaffServicesSchema } from "./staff.schema.js";
import * as staff from "./staff.service.js";

const idParam = z.string().uuid();

export const staffRouter = Router();
staffRouter.use(requireAuth);

// POST /businesses/:id/staff  → add a staff member
staffRouter.post("/:id/staff", validateBody(createStaffSchema), async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const member = await staff.createStaff(businessId, currentUserId(req), req.body);
  res.status(201).json({ staff: member });
});

// GET /businesses/:id/staff  → list staff with the services each one offers
staffRouter.get("/:id/staff", async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  res.json({ staff: await staff.listStaff(businessId, currentUserId(req)) });
});

// PUT /businesses/:id/staff/:staffId/services  → replace the services a staff member offers
// PUT means "replace the whole thing with what I send" (PATCH means "change part of it").
staffRouter.put("/:id/staff/:staffId/services", validateBody(setStaffServicesSchema), async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const staffId = idParam.parse(req.params.staffId);
  const member = await staff.setStaffServices(businessId, staffId, currentUserId(req), req.body);
  res.json({ staff: member });
});
