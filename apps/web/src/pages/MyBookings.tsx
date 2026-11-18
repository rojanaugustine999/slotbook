import { useState } from "react";
import { Link } from "react-router";
import { describeError } from "../api/client";
import { useCancelBooking, useMyBookings, usePayDeposit } from "../api/hooks";
import type { Booking } from "../api/types";
import { useAuthDialog } from "../auth/AuthDialog";
import { useAuth } from "../auth/AuthProvider";
import { formatTimeOf, formatWhen, isInFuture } from "../lib/dates";
import { CheckoutClosed } from "../lib/razorpay";
import { formatPrice } from "../lib/money";
import { Button, Spinner } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Notice } from "../ui/Notice";
import { WakingUp } from "../ui/WakingUp";
import { StatusBadge } from "../ui/StatusBadge";

export function MyBookings() {
  const { status } = useAuth();
  const openAuth = useAuthDialog();
  const bookings = useMyBookings();

  if (status === "loading") return <Centered><Spinner className="size-6" /><WakingUp /></Centered>;

  if (status === "signedOut") {
    return (
      <Centered>
        <h1 className="text-xl font-medium">Your bookings</h1>
        <p className="mt-2 text-ink-2">Sign in to see your appointments, or cancel one.</p>
        <Button variant="primary" className="mt-5" onClick={() => openAuth({ reason: "Sign in to see your bookings." })}>
          Sign in
        </Button>
      </Centered>
    );
  }

  if (bookings.isPending) return <Centered><Spinner className="size-6" /><WakingUp /></Centered>;
  if (bookings.isError) return <Notice tone="error">{describeError(bookings.error)}</Notice>;

  const upcoming = bookings.data.filter((b) => (b.status === "confirmed" || b.status === "pending") && isInFuture(b.startsAt));
  const past = bookings.data.filter((b) => !upcoming.includes(b)).reverse(); // newest first

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-medium">Your bookings</h1>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-ink-2">Upcoming</h2>
        {upcoming.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-6 text-center">
            <p className="text-ink-2">You have nothing booked.</p>
            <Link to="/glow-salon" className="mt-2 inline-block font-medium text-accent underline underline-offset-2">
              Book an appointment
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((booking) => (
              <BookingCard key={booking.id} booking={booking} canCancel />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-3 text-sm font-medium text-ink-2">Past and cancelled</h2>
          <ul className="space-y-3">
            {past.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">{children}</div>;
}

function BookingCard({ booking, canCancel }: { booking: Booking; canCancel?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelBooking();

  return (
    <li className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium">{booking.service.name}</p>
          <p className="text-[15px] text-ink-2">{formatWhen(booking.startsAt, booking.business.timezone)}</p>
        </div>
        <StatusBadge status={booking.status} />
      </div>
      <p className="mt-2 text-sm text-ink-2">
        {booking.business.name} · with {booking.staff.name} · {formatPrice(booking.priceCents)}
        {booking.payment?.status === "paid" && ` · ${formatPrice(booking.payment.amountCents)} deposit paid`}
        {booking.payment?.status === "refunded" && ` · ${formatPrice(booking.payment.amountCents)} deposit refunded`}
      </p>

      {canCancel && <DepositDue booking={booking} />}

      {canCancel && (
        <div className="mt-4">
          <Button variant="danger" className="h-10" onClick={() => setConfirming(true)}>
            Cancel booking
          </Button>
        </div>
      )}

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Cancel this booking?">
        <p className="text-[15px] text-ink-2">
          {booking.service.name} on {formatWhen(booking.startsAt, booking.business.timezone)}. The time will be released for others, and we'll email you to confirm.
        </p>
        {booking.payment?.status === "paid" && (
          // Shown before they confirm, so nobody loses a deposit by surprise.
          <p className="mt-3 text-[15px]">
            {refundsOnCancel(booking)
              ? `Your ${formatPrice(booking.payment.amountCents)} deposit will be refunded.`
              : `It's less than ${booking.business.freeCancelHours} hours before your appointment, so the ${formatPrice(booking.payment.amountCents)} deposit won't be refunded.`}
          </p>
        )}
        {cancel.isError && <Notice tone="error" className="mt-4">{describeError(cancel.error)}</Notice>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={() => setConfirming(false)}>Keep booking</Button>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(booking.id, { onSuccess: () => setConfirming(false) })}>
            Cancel booking
          </Button>
        </div>
      </Dialog>
    </li>
  );
}

// A booking held for an unpaid deposit: say until when, and let the customer pay from here
// (they may have closed the payment window or reloaded the booking page).
function DepositDue({ booking }: { booking: Booking }) {
  const payForHold = usePayDeposit();
  if (booking.status !== "pending" || booking.payment?.status !== "created" || !booking.holdExpiresAt) return null;

  const deposit = formatPrice(booking.payment.amountCents);
  if (!isInFuture(booking.holdExpiresAt)) {
    return <Notice className="mt-3">The hold ran out before the {deposit} deposit was paid, so this time has been released.</Notice>;
  }

  const error = payForHold.error && !(payForHold.error instanceof CheckoutClosed) ? describeError(payForHold.error) : null;
  return (
    <div className="mt-3 rounded-control border border-line bg-warn-soft p-3.5">
      <p className="text-sm text-warn">
        Waiting for your {deposit} deposit. Pay by {formatTimeOf(booking.holdExpiresAt, booking.business.timezone)}, or the time is released for others.
      </p>
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
      {/* The payment's own result refreshes this list (usePayDeposit), so the card turns "Confirmed". */}
      <Button variant="primary" className="mt-3 h-10" loading={payForHold.isPending} onClick={() => payForHold.mutate({ booking })}>
        Pay {deposit} deposit
      </Button>
    </div>
  );
}

// The same rule as depositOutcome in the API (payments.rules.ts), only to WARN in advance.
// The server decides for real when the cancel arrives, with its own clock.
function refundsOnCancel(booking: Booking, now = Date.now()): boolean {
  const hoursAhead = (new Date(booking.startsAt).getTime() - now) / 3_600_000;
  return hoursAhead >= booking.business.freeCancelHours;
}
