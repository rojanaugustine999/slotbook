import type { DateTime } from "luxon";
import { describeError } from "../api/client";
import { useChangeBookingStatus } from "../api/hooks";
import type { OwnerBooking, OwnerStatusChange } from "../api/types";
import { formatDayLong, formatTimeRange, localDate } from "../lib/dates";
import { formatPrice } from "../lib/money";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Notice } from "../ui/Notice";
import { StatusBadge } from "../ui/StatusBadge";

interface Props {
  booking: OwnerBooking | null;
  businessId: string;
  timezone: string;
  now: DateTime;
  onClose: () => void;
}

export function BookingDialog({ booking, businessId, timezone, now, onClose }: Props) {
  const change = useChangeBookingStatus(businessId);

  function apply(status: OwnerStatusChange) {
    if (!booking) return;
    change.mutate({ bookingId: booking.id, status }, { onSuccess: onClose });
  }

  // These follow the rules the API enforces: an upcoming booking can be cancelled, and once it
  // has started the owner records what happened. Finished bookings can't be changed any more.
  const active = booking?.status === "confirmed" || booking?.status === "pending";
  const started = booking ? new Date(booking.startsAt) <= now.toJSDate() : false;

  return (
    <Dialog open={booking !== null} onClose={() => { change.reset(); onClose(); }} title={booking?.service.name ?? "Booking"}>
      {booking && (
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge status={booking.status} />
          </div>

          <dl className="mt-4 space-y-2.5 text-[15px]">
            <Row label="When" value={formatDayLong(localDate(booking.startsAt, timezone))} extra={formatTimeRange(booking.startsAt, booking.endsAt, timezone)} />
            <Row label="With" value={booking.staff.name} />
            <Row label="Price" value={formatPrice(booking.service.priceCents)} />
            <div className="border-t border-line pt-2.5">
              <Row label="Customer" value={booking.customer.name} />
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Email</dt>
              <dd className="min-w-0 truncate">
                <a href={`mailto:${booking.customer.email}`} className="text-accent underline underline-offset-2">
                  {booking.customer.email}
                </a>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Phone</dt>
              <dd>
                {booking.customer.phone ? (
                  <a href={`tel:${booking.customer.phone}`} className="text-accent underline underline-offset-2">
                    {booking.customer.phone}
                  </a>
                ) : (
                  <span className="text-ink-3">Not given</span>
                )}
              </dd>
            </div>
            {booking.notes && <Row label="Notes" value={booking.notes} />}
          </dl>

          {change.isError && <Notice tone="error" className="mt-4">{describeError(change.error)}</Notice>}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => { change.reset(); onClose(); }}>Close</Button>
            {active && !started && (
              <Button variant="danger" loading={change.isPending} onClick={() => apply("cancelled")}>
                Cancel booking
              </Button>
            )}
            {active && started && (
              <>
                <Button loading={change.isPending && change.variables?.status === "no_show"} disabled={change.isPending} onClick={() => apply("no_show")}>
                  Mark no-show
                </Button>
                <Button variant="primary" loading={change.isPending && change.variables?.status === "completed"} disabled={change.isPending} onClick={() => apply("completed")}>
                  Mark completed
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Row({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right">
        {value}
        {extra && <span className="block text-sm text-ink-2">{extra}</span>}
      </dd>
    </div>
  );
}
