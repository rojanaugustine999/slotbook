import express, { Router } from "express";
import { handleRazorpayWebhook } from "./payments.webhook.js";

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
