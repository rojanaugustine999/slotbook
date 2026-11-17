import type { DateTime } from "luxon";
import type { CalendarDay, OwnerBooking } from "../api/types";
import { cn } from "../lib/cn";
import { formatHourLabel, formatTimeOf, minutesOfDay } from "../lib/dates";
import { calendarHours, layoutDay } from "./layout";
import { staffStyle } from "./staffStyles";

const HOUR_PX = 56; // how tall one hour is on screen
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Props {
  days: CalendarDay[];
  timezone: string;
  today: string;
  now: DateTime;
  staffIndex: Map<string, number>; // staff id -> colour slot
  onSelect: (booking: OwnerBooking) => void;
}

/** How one booking block looks: the staff colour normally, and a different treatment for each status that matters. */
export function blockClasses(booking: OwnerBooking, staffSlot: number): string {
  if (booking.status === "cancelled") return "border-line-strong border-dashed bg-transparent text-ink-3";
  if (booking.status === "no_show") return "border-danger bg-danger-soft";
  return staffStyle(staffSlot).block;
}

export function WeekGrid({ days, timezone, today, now, staffIndex, onSelect }: Props) {
  const times = (booking: OwnerBooking) => ({ startMin: minutesOfDay(booking.startsAt, timezone), endMin: minutesOfDay(booking.endsAt, timezone) });
  const { startHour, endHour } = calendarHours(days.flatMap((day) => day.bookings.map(times)));
  const rangeStart = startHour * 60;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const bodyHeight = hours.length * HOUR_PX;
  const nowMin = minutesOfDay(now.toISO() ?? "", timezone);

  const columns = "grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]";

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      {/* Day headings */}
      <div className={cn(columns, "border-b border-line")}>
        <div />
        {days.map((day, i) => {
          const isToday = day.date === today;
          return (
            <div key={day.date} className="border-l border-line py-2 text-center">
              <div className={cn("text-xs", isToday ? "font-medium text-accent-ink" : "text-ink-2")}>{WEEKDAYS[i]}</div>
              <div className={cn("mx-auto mt-0.5 grid size-8 place-items-center rounded-full text-[15px]", isToday ? "bg-accent font-medium text-on-accent" : "text-ink")}>{Number(day.date.slice(8))}</div>
            </div>
          );
        })}
      </div>

      {/* The hours, and a column of bookings for each day */}
      <div className={columns} style={{ height: bodyHeight }}>
        <div className="relative">
          {hours.map((hour, i) => (
            <span key={hour} className="absolute right-2 -translate-y-1/2 text-[11px] text-ink-3" style={{ top: i * HOUR_PX, display: i === 0 ? "none" : undefined }}>
              {formatHourLabel(hour)}
            </span>
          ))}
        </div>

        {days.map((day) => {
          const placed = layoutDay(day.bookings, times);
          const showNow = day.date === today && nowMin >= rangeStart && nowMin <= endHour * 60;
          return (
            <div key={day.date} className="relative border-l border-line">
              {hours.map((hour, i) => i > 0 && <div key={hour} className="absolute inset-x-0 border-t border-line" style={{ top: i * HOUR_PX }} />)}

              {placed.map(({ item: booking, lane, lanes, startMin, endMin }) => {
                const top = ((startMin - rangeStart) / 60) * HOUR_PX;
                const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 26);
                const slot = staffIndex.get(booking.staff.id) ?? 0;
                const cancelled = booking.status === "cancelled";
                // Two lines need about 40px. A short booking (a 20-minute beard trim is 26px tall)
                // gets one line, name then time, instead of a second line cut in half.
                const oneLine = height < 40;
                const time = formatTimeOf(booking.startsAt, timezone).replace(" ", "");
                return (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => onSelect(booking)}
                    aria-label={`${booking.customer.name}, ${booking.service.name} with ${booking.staff.name}, ${formatTimeOf(booking.startsAt, timezone)}, ${booking.status.replace("_", " ")}`}
                    title={`${booking.customer.name}: ${booking.service.name} with ${booking.staff.name}, ${formatTimeOf(booking.startsAt, timezone)}`}
                    className={cn(
                      "absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs leading-snug transition-[filter] hover:brightness-95",
                      blockClasses(booking, slot),
                    )}
                    style={{ top, height: height - 2, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                  >
                    <span className={cn("flex items-center gap-1 truncate font-medium", cancelled && "line-through")}>
                      {booking.status === "completed" && (
                        <svg viewBox="0 0 24 24" className="size-3 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      )}
                      {/* Two bookings sharing a column leave each only about 65px, so show less: a first name and the time. */}
                      <span className="truncate">{lanes > 1 ? booking.customer.name.split(" ")[0] : booking.customer.name}</span>
                      {oneLine && <span className={cn("shrink-0 font-normal", cancelled ? "text-ink-3" : "text-ink-2")}>{time}</span>}
                    </span>
                    {!oneLine && (
                      <span className={cn("block truncate", cancelled ? "text-ink-3" : "text-ink-2")}>
                        {time}
                        {lanes === 1 && ` · ${booking.service.name}`}
                        {lanes === 1 && booking.status === "no_show" && " · no-show"}
                      </span>
                    )}
                  </button>
                );
              })}

              {showNow && (
                <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-accent" style={{ top: ((nowMin - rangeStart) / 60) * HOUR_PX }} aria-hidden="true">
                  <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-accent" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
