import { Link } from "react-router";
import type { Booking } from "../api/types";
import { formatWhen } from "../lib/dates";
import { formatDuration, formatPrice } from "../lib/money";
import { Button } from "../ui/Button";

interface SummaryProps {
  serviceName: string;
  durationMin: number;
  priceCents: number;
  staffLabel: string;
  whenLabel: string | null; // null until a time is chosen
  busy: boolean;
  onConfirm: () => void;
}

export function Summary({ serviceName, durationMin, priceCents, staffLabel, whenLabel, busy, onConfirm }: SummaryProps) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-[15px] font-medium">Your booking</h2>
      <dl className="mt-4 space-y-2.5 text-[15px]">
        <Row label="Service" value={`${serviceName} · ${formatDuration(durationMin)}`} />
        <Row label="With" value={staffLabel} />
        <Row label="When" value={whenLabel ?? "Choose a time"} muted={!whenLabel} />
        <div className="border-t border-line pt-2.5">
          <Row label="Total" value={formatPrice(priceCents)} strong />
        </div>
      </dl>
      <Button variant="primary" block className="mt-5" disabled={!whenLabel} loading={busy} onClick={onConfirm}>
        Confirm booking
      </Button>
      <p className="mt-3 text-center text-xs text-ink-3">You'll get an email confirmation, and a reminder before your appointment.</p>
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
