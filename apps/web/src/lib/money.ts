// The API stores prices as whole paise ("priceCents": 50000 means ₹500), so no
// decimals ever go wrong. We only convert to rupees here, at the very edge.
const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "₹500" when it is a whole number of rupees, "₹199.50" when there are paise.
export function formatPrice(priceCents: number): string {
  return (priceCents % 100 === 0 ? whole : withPaise).format(priceCents / 100);
}

// ─── Typed price → paise ─────────────────────────────────────────────────────
// "1,200.50" → 120050. We read the rupees and the paise as two whole numbers instead of
// doing parseFloat(text) * 100, because decimals in binary are inexact:
// 19.99 * 100 is 1998.9999999999998 in JavaScript. Whole numbers never have that problem.
// ──────────────────────────────────────────────────────────────────────────────
/** The price in paise, or null when the text isn't a price (at most 2 decimals, not negative). */
export function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, ""); // allow "₹1,200" as people write it
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const rupees = Number(match[1]);
  const paise = Number((match[2] ?? "").padEnd(2, "0")); // ".5" means 50 paise, not 5
  return rupees * 100 + paise;
}

/** 120050 → "1200.50", 50000 → "500": how a price looks inside an input box. */
export function priceInputValue(priceCents: number): string {
  const rupees = Math.floor(priceCents / 100);
  const paise = priceCents % 100;
  return paise === 0 ? String(rupees) : `${rupees}.${String(paise).padStart(2, "0")}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// ─── Deposits ────────────────────────────────────────────────────────────────
// The same rule as depositFor in the API (payments.service.ts), only to SHOW the amount
// before booking. What's actually charged always comes from the server's Razorpay order.
// ──────────────────────────────────────────────────────────────────────────────
/** The deposit in paise for a price, or null when none is due. At least ₹1, at most the price. */
export function depositFor(priceCents: number, depositPercent: number | null): number | null {
  if (!depositPercent || priceCents < 100) return null;
  const deposit = Math.round((priceCents * depositPercent) / 100);
  return Math.min(priceCents, Math.max(100, deposit));
}
