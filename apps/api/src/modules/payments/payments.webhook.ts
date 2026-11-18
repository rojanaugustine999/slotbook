import { prisma } from "../../lib/db.js";
import { env } from "../../lib/env.js";
import { HttpError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { verifyWebhookSignature } from "../../lib/razorpay.js";
import { recordPayment } from "./payments.service.js";

// ─── Razorpay webhooks ───────────────────────────────────────────────────────
// Razorpay calls POST /webhooks/razorpay itself when something happens to a payment. This is
// the safety net for "paid, then closed the tab": the browser never reports back, but
// Razorpay still tells us, so the booking is confirmed anyway.
//
// The rules for a webhook endpoint:
//   1. Check the signature before trusting a single byte (anyone can POST to this URL).
//   2. Expect repeats: Razorpay retries until it gets a 2xx, so the same event can arrive
//      twice or more. Handling it twice must change nothing.
//   3. Answer 2xx for events we don't care about too, or Razorpay keeps retrying them.
// ──────────────────────────────────────────────────────────────────────────────

// The events that mean "the money arrived". Razorpay may send both for one payment,
// which is fine: the second finds the payment already paid.
const PAID_EVENTS = new Set(["payment.captured", "order.paid"]);

interface RazorpayEvent {
  event: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string } } };
}

export type WebhookOutcome = "recorded" | "already-handled" | "duplicate-event" | "ignored";

export async function handleRazorpayWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined): Promise<WebhookOutcome> {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new HttpError(503, "WEBHOOKS_NOT_CONFIGURED", "Webhooks are not set up");
  if (!signature || !verifyWebhookSignature(rawBody, signature)) throw new HttpError(400, "INVALID_SIGNATURE", "Invalid webhook signature");

  // A repeat delivery of an event we already handled: nothing to do.
  if (eventId && (await prisma.webhookEvent.findUnique({ where: { eventId }, select: { id: true } }))) return "duplicate-event";

  const event = JSON.parse(rawBody.toString("utf8")) as RazorpayEvent;
  const outcome = await applyEvent(event);

  // Remembered only AFTER it was handled. If we crashed halfway, Razorpay's retry must
  // still be processed, not skipped. (Two copies arriving at the very same moment can both
  // get past the check above; recordPayment's guarded update makes that harmless too.)
  if (eventId) await prisma.webhookEvent.createMany({ data: [{ eventId, type: event.event }], skipDuplicates: true });
  return outcome;
}

async function applyEvent(event: RazorpayEvent): Promise<WebhookOutcome> {
  if (!PAID_EVENTS.has(event.event)) return "ignored";

  const entity = event.payload?.payment?.entity;
  if (!entity?.id || !entity.order_id) return "ignored";

  // Orders from elsewhere on the same Razorpay account aren't ours: ignore them.
  const payment = await prisma.payment.findUnique({
    where: { providerOrderId: entity.order_id },
    select: { id: true, businessId: true, bookingId: true, amountCents: true, currency: true },
  });
  if (!payment) return "ignored";

  // Belt and braces: the amount Razorpay took must be the deposit we asked for.
  if (entity.amount !== payment.amountCents || entity.currency !== payment.currency) {
    logger.error({ orderId: entity.order_id, paid: entity.amount, expected: payment.amountCents }, "webhook amount does not match the order");
    return "ignored";
  }

  const { firstTime } = await recordPayment(payment, entity.id);
  return firstTime ? "recorded" : "already-handled";
}
