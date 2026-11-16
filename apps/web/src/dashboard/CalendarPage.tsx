import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { describeError } from "../api/client";
import { useCalendar, useStaff } from "../api/hooks";
import { cn } from "../lib/cn";
import { formatWeekRange, shiftDays, startOfWeek, todayIn } from "../lib/dates";
import { Button, Spinner } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { Agenda } from "./Agenda";
import { BookingDialog } from "./BookingDialog";
import { useDashboardBusiness } from "./DashboardLayout";
import { staffStyle } from "./staffStyles";
import { useNow } from "./useNow";
import { WeekGrid } from "./WeekGrid";

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function CalendarPage() {
  const business = useDashboardBusiness();
  const now = useNow();
  const today = todayIn(business.timezone, now);

  // Which week is on screen lives in the address (?week=2026-11-23), so a refresh,
  // the back button and a shared link all land on the same week.
  const [params, setParams] = useSearchParams();
  const requested = params.get("week");
  const weekStart = startOfWeek(requested && DATE_FORMAT.test(requested) ? requested : today);
  const weekEnd = shiftDays(weekStart, 6);
  const isThisWeek = weekStart === startOfWeek(today);

  function goToWeek(start: string) {
    setParams(start === startOfWeek(today) ? {} : { week: start }, { replace: false });
  }

  const staff = useStaff(business.id);
  const calendar = useCalendar(business.id, weekStart, weekEnd);

  const [hiddenStaff, setHiddenStaff] = useState<Set<string>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // One colour per staff member, in a stable order.
  const staffIndex = useMemo(() => new Map((staff.data ?? []).map((member, i) => [member.id, i])), [staff.data]);

  // What to show after the filters. Empty days are kept: they are part of the week.
  const days = useMemo(
    () =>
      (calendar.data?.days ?? []).map((day) => ({
        ...day,
        bookings: day.bookings.filter((b) => !hiddenStaff.has(b.staff.id) && (showCancelled || b.status !== "cancelled")),
      })),
    [calendar.data, hiddenStaff, showCancelled],
  );

  // Look the open booking up in the freshest data, so it updates after a status change.
  const selected = days.flatMap((d) => d.bookings).find((b) => b.id === selectedId) ?? null;
  const total = days.reduce((sum, day) => sum + day.bookings.length, 0);

  function toggleStaff(id: string) {
    setHiddenStaff((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {/* Week navigation */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button className="size-10 px-0" aria-label="Previous week" onClick={() => goToWeek(shiftDays(weekStart, -7))}>
            <Chevron direction="left" />
          </Button>
          <Button className="size-10 px-0" aria-label="Next week" onClick={() => goToWeek(shiftDays(weekStart, 7))}>
            <Chevron direction="right" />
          </Button>
          <h2 className="ml-1 text-lg font-medium" aria-live="polite">
            {formatWeekRange(weekStart)}
          </h2>
          {calendar.isFetching && !calendar.isPending && <Spinner className="text-ink-3" />}
        </div>
        <Button className="h-10" disabled={isThisWeek} onClick={() => goToWeek(startOfWeek(today))}>
          This week
        </Button>
      </div>

      {/* Which staff and which bookings to show */}
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2" role="group" aria-label="Filters">
        {(staff.data ?? []).map((member, i) => {
          const visible = !hiddenStaff.has(member.id);
          return (
            <button
              key={member.id}
              type="button"
              aria-pressed={visible}
              onClick={() => toggleStaff(member.id)}
              className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors", visible ? "border-line-strong bg-surface" : "border-line bg-transparent text-ink-3")}
            >
              <span className={cn("size-2.5 rounded-full", staffStyle(i).dot, !visible && "opacity-30")} aria-hidden="true" />
              <span className={cn(!visible && "line-through")}>{member.name}</span>
            </button>
          );
        })}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} className="size-4 accent-[var(--accent)]" />
          Show cancelled
        </label>
      </div>

      {calendar.isPending ? (
        <div className="flex justify-center py-24 text-ink-3">
          <Spinner className="size-6" />
        </div>
      ) : calendar.isError ? (
        <Notice tone="error">{describeError(calendar.error)}</Notice>
      ) : (
        <>
          {total === 0 && <Notice className="mb-4">Nothing is booked in this week.</Notice>}
          <div className="hidden md:block">
            <WeekGrid days={days} timezone={business.timezone} today={today} now={now} staffIndex={staffIndex} onSelect={(b) => setSelectedId(b.id)} />
          </div>
          <div className="md:hidden">
            <Agenda days={days} timezone={business.timezone} today={today} staffIndex={staffIndex} onSelect={(b) => setSelectedId(b.id)} />
          </div>
        </>
      )}

      <BookingDialog booking={selected} businessId={business.id} timezone={business.timezone} now={now} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}
