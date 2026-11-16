import type { CalendarDay, OwnerBooking } from "../api/types";
import { cn } from "../lib/cn";
import { formatDayLong, formatTimeRange } from "../lib/dates";
import { StatusBadge } from "../ui/StatusBadge";
import { staffStyle } from "./staffStyles";

interface Props {
  days: CalendarDay[];
  timezone: string;
  today: string;
  staffIndex: Map<string, number>;
  onSelect: (booking: OwnerBooking) => void;
}

// A week grid needs width a phone doesn't have, so small screens get a plain day-by-day
// list instead: same bookings, same colours, easy to read and tap.
export function Agenda({ days, timezone, today, staffIndex, onSelect }: Props) {
  return (
    <div className="space-y-6">
      {days.map((day) => (
        <section key={day.date} aria-label={formatDayLong(day.date)}>
          <h3 className={cn("mb-2 text-sm font-medium", day.date === today ? "text-accent-ink" : "text-ink-2")}>
            {formatDayLong(day.date)}
            {day.date === today && " · Today"}
          </h3>

          {day.bookings.length === 0 ? (
            <p className="rounded-control border border-dashed border-line px-3 py-2.5 text-sm text-ink-3">Nothing booked</p>
          ) : (
            <ul className="space-y-2">
              {day.bookings.map((booking) => {
                const cancelled = booking.status === "cancelled";
                return (
                  <li key={booking.id}>
                    <button type="button" onClick={() => onSelect(booking)} className="flex w-full items-start gap-3 rounded-control border border-line bg-surface p-3 text-left hover:bg-sunken">
                      <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", staffStyle(staffIndex.get(booking.staff.id) ?? 0).dot, cancelled && "opacity-40")} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[15px] font-medium", cancelled && "text-ink-3 line-through")}>{booking.customer.name}</span>
                        <span className="block text-sm text-ink-2">{formatTimeRange(booking.startsAt, booking.endsAt, timezone)}</span>
                        <span className="block text-sm text-ink-2">
                          {booking.service.name} · with {booking.staff.name}
                        </span>
                      </span>
                      <StatusBadge status={booking.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
