import { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { recordPayoutSchema } from "./admin.schema.js";
import * as admin from "./admin.service.js";

const idParam = z.string().uuid();

// ── Mounted at /admin: SlotBook's own staff only ───────────────────────────
export const adminRouter = Router();

// Every route here: signed in AND a platform admin (checked in the database each time).
adminRouter.use(requireAuth, async (req, _res, next) => {
  await admin.assertPlatformAdmin(currentUserId(req));
  next();
});

// GET /admin/balances → what SlotBook owes each salon
adminRouter.get("/balances", async (_req, res) => {
  res.json({ balances: await admin.listBalances() });
});

// POST /admin/businesses/:businessId/payouts  { amountCents, reference? }
adminRouter.post("/businesses/:businessId/payouts", validateBody(recordPayoutSchema), async (req, res) => {
  const businessId = idParam.parse(req.params.businessId);
  res.status(201).json({ payout: await admin.recordPayout(currentUserId(req), businessId, req.body) });
});

// GET /admin/refunds → refunds still pending or failed
adminRouter.get("/refunds", async (_req, res) => {
  res.json({ refunds: await admin.listOpenRefunds() });
});

// POST /admin/refunds/:refundId/retry
adminRouter.post("/refunds/:refundId/retry", async (req, res) => {
  const refundId = idParam.parse(req.params.refundId);
  res.json({ refund: await admin.retryRefund(currentUserId(req), refundId) });
});

// GET /admin/audit → the latest admin actions
adminRouter.get("/audit", async (_req, res) => {
  res.json({ entries: await admin.listAuditLog() });
});
