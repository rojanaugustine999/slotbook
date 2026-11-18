// ─── Who keeps a paid deposit ────────────────────────────────────────────────
// Pure functions, no database: the whole policy in one place that tests can read like a table.
//
//   customer cancels, early enough   → refund
//   customer cancels, too late       → the salon keeps it
//   the salon cancels                → refund (not the customer's fault)
//   completed / no-show              → the salon keeps it
//   paid after the hold ran out      → refund (the slot was already released)
// ──────────────────────────────────────────────────────────────────────────────

/** SlotBook's share of every deposit a salon keeps. */
export const COMMISSION_PERCENT = 10;

export type DepositEvent =
  | { kind: "customer_cancelled"; startsAt: Date; now: Date; freeCancelHours: number }
  | { kind: "salon_cancelled" }
  | { kind: "completed" }
  | { kind: "no_show" }
  | { kind: "hold_expired" };

export function depositOutcome(event: DepositEvent): "refund" | "keep" {
  switch (event.kind) {
    case "customer_cancelled": {
      const hoursAhead = (event.startsAt.getTime() - event.now.getTime()) / 3_600_000;
      // Exactly on the limit still counts as in time: "at least 24 hours before".
      return hoursAhead >= event.freeCancelHours ? "refund" : "keep";
    }
    case "salon_cancelled":
    case "hold_expired":
      return "refund";
    case "completed":
    case "no_show":
      return "keep";
  }
}

/** The commission in paise, rounded to whole paise. */
export function commissionFor(depositCents: number): number {
  return Math.round((depositCents * COMMISSION_PERCENT) / 100);
}
