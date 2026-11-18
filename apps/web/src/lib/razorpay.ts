import type { DepositCheckout, RazorpayResult } from "../api/types";

// ─── Razorpay Checkout ───────────────────────────────────────────────────────
// Razorpay's payment window comes from their own script. Card numbers and UPI details are
// typed into THEIR window, never into our page, so SlotBook never sees them.
//
// We load the script only when someone actually pays, so the rest of the site stays fast.
// ──────────────────────────────────────────────────────────────────────────────

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", handler: (response: { error: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null; // let a later click try again
      reject(new Error("Couldn't load the payment window. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Thrown when the customer closes the payment window without paying. */
export class CheckoutClosed extends Error {
  constructor() {
    super("Payment window closed");
  }
}

/**
 * Opens Razorpay Checkout for a deposit. Resolves with what Razorpay returns on success,
 * rejects with CheckoutClosed if the customer closes it, or an Error if the payment fails.
 */
export async function payDeposit(checkout: DepositCheckout, details: { description: string; name?: string; email?: string }): Promise<RazorpayResult> {
  await loadScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error("Couldn't load the payment window.");

  return new Promise<RazorpayResult>((resolve, reject) => {
    const rzp = new Razorpay({
      key: checkout.keyId,
      order_id: checkout.orderId, // the amount comes from this order, created on our server
      amount: checkout.amountCents,
      currency: checkout.currency,
      name: "SlotBook",
      description: details.description,
      prefill: { name: details.name, email: details.email },
      theme: { color: "#0f766e" }, // SlotBook teal (--accent)
      handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        resolve({ razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id, razorpaySignature: r.razorpay_signature }),
      modal: { ondismiss: () => reject(new CheckoutClosed()) },
    });
    // A declined card: Razorpay shows it to the customer, who can retry inside the window.
    // We only log it; closing the window is what ends the attempt.
    rzp.on("payment.failed", (response) => console.warn("Razorpay payment failed:", response.error.description));
    rzp.open();
  });
}
