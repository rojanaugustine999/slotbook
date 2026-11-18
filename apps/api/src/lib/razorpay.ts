import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

// ─── Razorpay, the parts SlotBook uses ───────────────────────────────────────
// We call Razorpay's REST API directly with fetch (no SDK): it's two calls, and this
// way every request is visible and easy to replace in tests.
//
//   1. createOrder:  "a customer is about to pay ₹X". Razorpay answers with an order id
//                    that the browser's Checkout uses.
//   2. the signature: after paying, Razorpay gives the browser a signature that only
//                    someone holding OUR secret could have produced. Checking it is how
//                    we know a payment really happened, rather than trusting the browser.
// ──────────────────────────────────────────────────────────────────────────────

export interface RazorpayOrder {
  id: string; // "order_..."
  amount: number; // paise
  currency: string;
  status: string;
}

/** True when both keys are set, so salons can take deposits. */
export function paymentsConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

// An object rather than loose functions, so tests can replace createOrder
// (vi.spyOn(razorpay, "createOrder")) and never call the real Razorpay.
export const razorpay = {
  async createOrder(input: { amountCents: number; receipt: string; notes?: Record<string, string> }): Promise<RazorpayOrder> {
    return call<RazorpayOrder>("POST", "/orders", { amount: input.amountCents, currency: "INR", receipt: input.receipt, notes: input.notes });
  },

  /** Sends money back for a payment. notes.refundId is OUR refund id, used to spot repeats. */
  async refundPayment(paymentId: string, input: { amountCents: number; notes: { refundId: string } }): Promise<RazorpayRefund> {
    return call<RazorpayRefund>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: input.amountCents, notes: input.notes });
  },

  /** The refunds Razorpay already has for a payment (to check before trying again). */
  async listRefunds(paymentId: string): Promise<RazorpayRefund[]> {
    return (await call<{ items: RazorpayRefund[] }>("GET", `/payments/${encodeURIComponent(paymentId)}/refunds`)).items;
  },
};

export interface RazorpayRefund {
  id: string; // "rfnd_..."
  amount: number;
  status: "pending" | "processed" | "failed";
  notes?: Record<string, string> | [];
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      // Basic auth: "key id:secret", base64. Sent only from the server, over HTTPS.
      Authorization: "Basic " + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Razorpay answered ${res.status} to ${method} ${path.split("/")[1]}`);
  return (await res.json()) as T;
}

/**
 * Checks the signature Razorpay Checkout returns after a successful payment.
 * Razorpay signs "<order id>|<payment id>" with HMAC-SHA256 using our key secret, so a
 * matching signature proves the payment ids came from Razorpay and weren't made up.
 */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = createHmac("sha256", env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  return sameText(expected, signature);
}

/**
 * Checks the X-Razorpay-Signature header of a webhook. Razorpay signs the RAW request body
 * with the webhook secret (a different secret from the API key's, set in the dashboard when
 * adding the webhook). It must be the raw bytes: parsing the JSON and turning it back into
 * text can change spacing or key order, and then the signature would never match.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return sameText(expected, signature);
}

// timingSafeEqual takes the same time however many characters match. A normal ===
// stops at the first difference, and that timing can leak, character by character,
// what the right signature is.
function sameText(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
