// The shapes the SlotBook API sends back. Written by hand to match the API's responses
// (apps/api/src/modules/*). Later these could be shared from one package.

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  isPlatformAdmin?: boolean; // SlotBook staff. Only decides whether the Admin link shows
}

// ── Super admin: /admin ─────────────────────────────────────────────────────
export interface SalonBalance {
  id: string;
  name: string;
  slug: string;
  // Each ledger type added up, in paise: deposit is +, the rest are − (what reduces the balance).
  totals: { deposit: number; commission: number; refund: number; payout: number };
  balanceCents: number; // what SlotBook owes the salon now
}

export interface AdminSalon {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  owner: { name: string; email: string; phone: string | null };
  _count: { bookings: number };
}

export interface OpenRefund {
  id: string;
  amountCents: number;
  status: "pending" | "failed";
  reason: string | null;
  providerRefundId: string | null;
  createdAt: string;
  payment: { business: { name: string; slug: string } };
}

export interface AuditEntry {
  id: string;
  action: string; // "payout.record", "refund.retry"
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  actor: { name: string; email: string };
}

// ── Public salon page: GET /b/:slug ─────────────────────────────────────────
export interface PublicService {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number; // whole paise
}

export interface PublicStaff {
  id: string;
  name: string;
  services: { serviceId: string }[]; // which services this person offers
}

export interface PublicBusiness {
  id: string;
  name: string;
  slug: string;
  timezone: string; // IANA name, e.g. "Asia/Kolkata"
  address: string | null;
  depositPercent: number | null; // null: no deposit, everything is paid at the salon
  freeCancelHours: number; // cancel at least this many hours ahead to get the deposit back
  services: PublicService[];
  staff: PublicStaff[];
}

// ── The home page's list: GET /b ────────────────────────────────────────────
export interface PublicBusinessCard {
  name: string;
  slug: string;
  address: string | null;
  services: string[]; // up to three names, A to Z
}

// ── Availability: GET /b/:slug/availability ─────────────────────────────────
export interface Slot {
  time: string; // "09:30", in the salon's timezone
  staffIds: string[]; // who is free at that time
}

export interface Availability {
  date: string;
  timezone: string;
  slots: Slot[];
}

// ── Bookings ────────────────────────────────────────────────────────────────
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

export interface Booking {
  id: string;
  startsAt: string; // an exact moment, in UTC
  endsAt: string;
  priceCents: number; // the price when it was booked. Show this, not service.priceCents (today's price)
  status: BookingStatus;
  notes: string | null;
  service: { id: string; name: string; durationMin: number; priceCents: number };
  staff: { id: string; name: string };
  business: { name: string; slug: string; timezone: string; freeCancelHours: number };
  holdExpiresAt: string | null; // set while the slot is held for an unpaid deposit
  payment: { amountCents: number; currency: string; status: PaymentStatus } | null;
}

export type PaymentStatus = "created" | "paid" | "failed" | "refunded";

// What the API returns when a deposit is due: everything Razorpay Checkout needs.
export interface DepositCheckout {
  orderId: string;
  amountCents: number;
  currency: string;
  keyId: string; // Razorpay's PUBLIC key id. The secret never leaves the server.
}

// What Razorpay Checkout hands the browser after a payment. Only claims until the API checks the signature.
export interface RazorpayResult {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

// ── Owner side ──────────────────────────────────────────────────────────────
export interface OwnedBusiness {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  address: string | null;
  suspendedAt?: string | null; // set by SlotBook: hidden, no new bookings
  suspendedReason?: string | null; // why, shown to the owner
}

/** A service as the owner sees it: includes hidden ones and the cleanup time. */
export interface OwnerService {
  id: string;
  name: string;
  durationMin: number;
  bufferMin: number; // cleanup time after each appointment, not shown to customers
  priceCents: number;
  active: boolean;
}

export interface ServiceInput {
  name: string;
  durationMin: number;
  bufferMin: number;
  priceCents: number;
}

export interface TimeOff {
  id: string;
  startsAt: string; // exact moments, in UTC
  endsAt: string;
  reason: string | null;
}

export interface StaffMember {
  id: string;
  name: string;
  active: boolean;
  services: { id: string; name: string }[];
}

// What an owner sees of a booking: the customer's contact details too.
export interface OwnerBooking extends Booking {
  customer: { id: string; name: string; email: string; phone: string | null };
}

export interface CalendarDay {
  date: string; // "2026-11-23", a calendar day in the salon's timezone
  bookings: OwnerBooking[]; // soonest first
}

export interface Calendar {
  timezone: string;
  days: CalendarDay[]; // every day in the range, even empty ones
}

export type OwnerStatusChange = "cancelled" | "completed" | "no_show";

// GET /businesses/:id/stats
export interface Stats {
  from: string;
  to: string;
  timezone: string;
  total: number; // every booking in the range, whatever its status
  byStatus: Record<BookingStatus, number>;
  noShowRate: number | null; // 0.25 means 25%. null until an appointment has finished
  revenueCents: number; // whole paise, from completed bookings only
  bookingsPerDay: { date: string; count: number }[]; // every day in the range, cancelled bookings left out
  topServices: { serviceId: string; name: string; bookings: number; revenueCents: number }[];
}

export interface CreateBookingInput {
  serviceId: string;
  staffId?: string; // leave out for "anyone"
  startsAt: string; // ISO with a timezone offset
  notes?: string;
}

// ── Owner's Payments tab: GET /businesses/:id/payments ──────────────────────
export type LedgerEntryType = "deposit" | "commission" | "refund" | "payout";

export interface OwnerPayments {
  settings: {
    depositPercent: number | null; // null: no deposit
    freeCancelHours: number;
    paymentsAvailable: boolean; // false: the server has no Razorpay keys, so nothing is charged
    commissionPercent: number;
  };
  // Each type added up, in paise, from the salon's side: deposit +, the others −.
  totals: Record<LedgerEntryType, number>;
  balanceCents: number; // what SlotBook owes the salon now
  entries: {
    id: string;
    type: LedgerEntryType;
    amountCents: number; // signed, like the totals
    createdAt: string;
    booking: { id: string; startsAt: string; service: { name: string }; customer: { name: string } } | null;
    payoutReference: string | null;
  }[];
}
