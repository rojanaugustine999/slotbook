import express, { Router } from "express";
import { z } from "zod";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { getOwnerPayments } from "./payments.owner.js";
import { handleRazorpayWebhook } from "./payments.webhook.js";

// ── Mounted at /businesses: the owner's Payments tab ───────────────────────
export const ownerPaymentsRouter = Router();

// GET /businesses/:id/payments → deposit settings, totals and recent ledger rows
ownerPaymentsRouter.get("/:id/payments", requireAuth, async (req, res) => {
  const businessId = z.string().uuid().parse(req.params.id);
  res.json(await getOwnerPayments(businessId, currentUserId(req)));
});

// ── Mounted at /webhooks ───────────────────────────────────────────────────
export const webhooksRouter = Router();

// POST /webhooks/razorpay: called by Razorpay, not by a browser. No login: the signature
// header is the proof it came from Razorpay.
// express.raw keeps the body as the exact bytes Razorpay signed. This router is mounted
// BEFORE the app's express.json(), which would otherwise parse it first.
webhooksRouter.post("/razorpay", express.raw({ type: "application/json", limit: "100kb" }), async (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const outcome = await handleRazorpayWebhook(body, req.header("x-razorpay-signature"), req.header("x-razorpay-event-id"));
  // Always a quick 200 once verified, whatever the outcome, so Razorpay stops retrying.
  res.json({ ok: true, outcome });
});
