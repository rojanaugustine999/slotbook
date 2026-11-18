import { Link } from "react-router";
import type { Booking } from "../api/types";
import { formatTimeOf, formatWhen } from "../lib/dates";
import { formatDuration, formatPrice } from "../lib/money";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";

interface SummaryProps {
  serviceName: string;
  durationMin: number;
  priceCents: number;
  staffLabel: string;
  whenLabel: string | null; // null until a time is chosen
  busy: boolean;
  onConfirm: () => void;
  depositCents: number | null; // null: nothing to pay now
  freeCancelHours: number;
}

export function Summary({ serviceName, durationMin, priceCents, staffLabel, whenLabel, busy, onConfirm, depositCents, freeCancelHours }: SummaryProps) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-[15px] font-medium">Your booking</h2>
      <dl className="mt-4 space-y-2.5 text-[15px]">
        <Row label="Service" value={`${serviceName} · ${formatDuration(durationMin)}`} />
        <Row label="With" value={staffLabel} />
        <Row label="When" value={whenLabel ?? "Choose a time"} muted={!whenLabel} />
        <div className="space-y-2.5 border-t border-line pt-2.5">
          <Row label="Total" value={formatPrice(priceCents)} strong={!depositCents} />
          {depositCents && (
            <>
              <Row label="Deposit now" value={formatPrice(depositCents)} strong />
              <Row label="At the salon" value={formatPrice(priceCents - depositCents)} />
            </>
          )}
        </div>
      </dl>
      <Button variant="primary" block className="mt-5" disabled={!whenLabel} loading={busy} onClick={onConfirm}>
        {depositCents ? `Pay ${formatPrice(depositCents)} and book` : "Confirm booking"}
      </Button>
      <p className="mt-3 text-center text-xs text-ink-3">
        {depositCents
          ? `Paid securely through Razorpay. Cancel at least ${cancelWindow(freeCancelHours)} before to get your deposit back.`
          : "You'll get an email confirmation, and a reminder before your appointment."}
      </p>
    </div>
  );
}

// 24 → "24 hours", 1 → "1 hour", 0 → "any time"
function cancelWindow(hours: number): string {
  if (hours === 0) return "any time";
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** The slot is held while the customer pays. Shown after they close the payment window. */
export function HeldView({ booking, depositCents, busy, error, onPay, onCancel, cancelling }: {
  booking: Booking;
  depositCents: number;
  busy: boolean;
  error: string | null;
  onPay: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const until = booking.holdExpiresAt ? formatTimeOf(booking.holdExpiresAt, booking.business.timezone) : null;
  return (
    <div className="mx-auto max-w-md rounded-card border border-line bg-surface p-6 text-center sm:p-8">
      <h1 className="text-xl font-medium">Your slot is held</h1>
      <p className="mt-1 text-[15px] text-ink-2">
        Pay the {formatPrice(depositCents)} deposit{until ? ` by ${until}` : ""} to confirm. After that, the time is released for others.
      </p>
      <dl className="mt-6 space-y-2.5 rounded-control bg-sunken p-4 text-left text-[15px]">
        <Row label="Service" value={booking.service.name} />
        <Row label="With" value={booking.staff.name} />
        <Row label="When" value={formatWhen(booking.startsAt, booking.business.timezone)} />
      </dl>
      {error && <Notice tone="error" className="mt-4 text-left">{error}</Notice>}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button variant="primary" loading={busy} onClick={onPay}>
          Pay {formatPrice(depositCents)} deposit
        </Button>
        <Button loading={cancelling} onClick={onCancel}>Cancel booking</Button>
      </div>
    </div>
  );
}


function Row({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-2">{label}</dt>
      <dd className={muted ? "text-ink-3" : strong ? "font-medium" : undefined}>{value}</dd>
    </div>
  );
}

// Shown on small screens once a time is picked, so the confirm button is always in reach.
export function MobileConfirmBar({ whenLabel, serviceName, busy, onConfirm }: { whenLabel: string; serviceName: string; busy: boolean; onConfirm: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 lg:hidden">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{serviceName}</p>
        <p className="truncate text-sm text-ink-2">{whenLabel}</p>
      </div>
      <Button variant="primary" loading={busy} onClick={onConfirm}>
        Confirm
      </Button>
    </div>
  );
}

export function ConfirmedView({ booking, email, onBookAnother }: { booking: Booking; email: string; onBookAnother: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-card border border-line bg-surface p-6 text-center sm:p-8">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h1 className="mt-4 text-xl font-medium">You're booked</h1>
      <p className="mt-1 text-[15px] text-ink-2">We've sent a confirmation to {email}.</p>

      <dl className="mt-6 space-y-2.5 rounded-control bg-sunken p-4 text-left text-[15px]">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-2">Service</dt>
          <dd>{booking.service.name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-2">With</dt>
          <dd>{booking.staff.name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-2">When</dt>
          <dd className="text-right">{formatWhen(booking.startsAt, booking.business.timezone)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-2">Where</dt>
          <dd>{booking.business.name}</dd>
        </div>
        {booking.payment?.status === "paid" && (
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Deposit paid</dt>
            <dd>{formatPrice(booking.payment.amountCents)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link to="/me" className="inline-flex h-11 items-center justify-center rounded-control bg-accent px-4 text-[15px] font-medium text-on-accent hover:bg-accent-hover">
          View my bookings
        </Link>
        <Button onClick={onBookAnother}>Book another time</Button>
      </div>
    </div>
  );
}
