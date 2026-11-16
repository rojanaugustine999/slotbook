import { cn } from "../lib/cn";
import { formatClock, formatDayLong, partOfDay, type DayOption, type PartOfDay } from "../lib/dates";
import type { Slot } from "../api/types";
import { Chip } from "../ui/Chip";
import { Notice } from "../ui/Notice";

// A row of days you can scroll sideways, like a date strip in a calendar app.
export function DayStrip({ days, selected, onSelect }: { days: DayOption[]; selected: string; onSelect: (date: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-sm text-ink-2">{formatDayLong(selected)}</p>
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:mx-0 sm:px-0" role="group" aria-label="Day">
        {days.map((day) => {
          const isSelected = day.date === selected;
          return (
            <button
              key={day.date}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${day.weekday} ${day.day} ${day.month}${day.isToday ? ", today" : ""}`}
              onClick={() => onSelect(day.date)}
              className={cn(
                "flex min-w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-control border px-2 py-2.5 transition-colors",
                isSelected ? "border-accent bg-accent-soft text-accent-ink ring-1 ring-accent" : "border-line-strong bg-surface hover:bg-sunken",
              )}
            >
              <span className="text-xs text-ink-2">{day.isToday ? "Today" : day.weekday}</span>
              <span className="text-lg font-medium leading-tight">{day.day}</span>
              <span className="text-xs text-ink-3">{day.month}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const GROUPS: PartOfDay[] = ["Morning", "Afternoon", "Evening"];

interface SlotPickerProps {
  slots: Slot[] | undefined;
  loading: boolean;
  error: boolean;
  selectedTime: string | null;
  onSelect: (time: string) => void;
}

// The open times for the chosen day, grouped so a long list stays easy to scan.
export function SlotPicker({ slots, loading, error, selectedTime, onSelect }: SlotPickerProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true" aria-label="Loading times">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-control bg-sunken" />
        ))}
      </div>
    );
  }
  if (error) return <Notice tone="error">We couldn't load the times. Please try again.</Notice>;
  if (!slots || slots.length === 0) return <Notice>No times are free on this day. Try another day, or another person.</Notice>;

  return (
    <div className="space-y-4">
      {GROUPS.map((group) => {
        const inGroup = slots.filter((slot) => partOfDay(slot.time) === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-2 text-sm text-ink-2">{group}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {inGroup.map((slot) => (
                <Chip key={slot.time} selected={slot.time === selectedTime} onClick={() => onSelect(slot.time)} className="px-2 text-center">
                  {formatClock(slot.time)}
                </Chip>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
