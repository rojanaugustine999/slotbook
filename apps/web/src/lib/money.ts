// The API stores prices as whole paise ("priceCents": 50000 means ₹500), so no
// decimals ever go wrong. We only convert to rupees here, at the very edge.
const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "₹500" when it is a whole number of rupees, "₹199.50" when there are paise.
export function formatPrice(priceCents: number): string {
  return (priceCents % 100 === 0 ? whole : withPaise).format(priceCents / 100);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
