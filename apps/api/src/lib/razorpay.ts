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
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        // Basic auth: "key id:secret", base64. Sent only from the server, over HTTPS.
        Authorization: "Basic " + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: input.amountCents, currency: "INR", receipt: input.receipt, notes: input.notes }),
    });
    if (!res.ok) throw new Error(`Razorpay answered ${res.status} when creating an order`);
    return (await res.json()) as RazorpayOrder;
  },
};

/**
 * Checks the signature Razorpay Checkout returns after a successful payment.
 * Razorpay signs "<order id>|<payment id>" with HMAC-SHA256 using our key secret, so a
 * matching signature proves the payment ids came from Razorpay and weren't made up.
 */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = createHmac("sha256", env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

  // timingSafeEqual takes the same time however many characters match. A normal ===
  // stops at the first difference, and that timing can leak, character by character,
  // what the right signature is.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
