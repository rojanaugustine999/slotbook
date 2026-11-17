import { useState } from "react";
import { Link } from "react-router";
import { describeError } from "../api/client";
import { useCancelBooking, useMyBookings } from "../api/hooks";
import type { Booking } from "../api/types";
import { useAuthDialog } from "../auth/AuthDialog";
import { useAuth } from "../auth/AuthProvider";
import { formatWhen, isInFuture } from "../lib/dates";
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
      </p>

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
