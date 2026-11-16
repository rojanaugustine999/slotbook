import type { BookingStatus } from "@prisma/client";

// ─── The booking "state machine" ─────────────────────────────────────────────
// A booking moves through statuses, and only some moves make sense:
//
//   pending ──► confirmed ──► completed
//      │            │    └──► no_show
//      └──► cancelled ◄┘
//
// cancelled, completed and no_show are FINAL: nothing comes after them.
// Writing the allowed moves down in one table means every route follows the
// same rules, and a mistake like "un-cancel a booking" is impossible by design.
// ──────────────────────────────────────────────────────────────────────────────

/** Bookings in these statuses hold their time slot. */
export const ACTIVE_STATUSES: BookingStatus[] = ["pending", "confirmed"];

const ALLOWED_NEXT: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["cancelled", "completed", "no_show"],
  cancelled: [],
  completed: [],
  no_show: [],
};

/**
 * Can a booking move from `from` to `to`?
 * Returns null when the move is allowed, or a sentence explaining why not.
 * Pure function: `now` is passed in so tests can control time.
 */
export function checkStatusChange(from: BookingStatus, to: BookingStatus, startsAt: Date, now: Date): string | null {
  if (!ALLOWED_NEXT[from].includes(to)) {
    return `A ${from} booking can't be changed to ${to}`;
  }

  // You can only say someone came (or didn't) once the appointment has started.
  if ((to === "completed" || to === "no_show") && startsAt > now) {
    return "This booking hasn't started yet";
  }

  return null;
}
