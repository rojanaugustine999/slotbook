import { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { createServiceSchema, updateServiceSchema } from "./services.schema.js";
import * as services from "./services.service.js";

// Rejects a malformed id in the URL with a clean 400 error.
const idParam = z.string().uuid();

export const servicesRouter = Router();

// Every route below needs a logged-in user.
servicesRouter.use(requireAuth);

// POST /businesses/:id/services  → create a service
servicesRouter.post("/:id/services", validateBody(createServiceSchema), async (req, res) => {
  const businessId = idParam.parse(req.params.id); // from the URL
  const userId = currentUserId(req);               // from the login token
  const service = await services.createService(businessId, userId, req.body);
  res.status(201).json({ service });               // 201 = Created
});

// GET /businesses/:id/services  → list services
servicesRouter.get("/:id/services", async (req, res) => {
  const businessId = idParam.parse(req.params.id); // from the URL
  const userId = currentUserId(req);               // from the login token
  const list = await services.listServices(businessId, userId);
  res.json({ services: list });                    // 200 = OK (the default)
});

// PATCH /businesses/:id/services/:serviceId  → change a service
servicesRouter.patch("/:id/services/:serviceId", validateBody(updateServiceSchema), async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const serviceId = idParam.parse(req.params.serviceId); // second id in the URL
  const userId = currentUserId(req);
  const service = await services.updateService(businessId, serviceId, userId, req.body);
  res.json({ service });
});

// DELETE /businesses/:id/services/:serviceId  → hide a service (soft delete)
servicesRouter.delete("/:id/services/:serviceId", async (req, res) => {
  const businessId = idParam.parse(req.params.id);
  const serviceId = idParam.parse(req.params.serviceId);
  const userId = currentUserId(req);
  await services.deactivateService(businessId, serviceId, userId);
  res.status(204).end();                           // 204 = done, nothing to send back
});