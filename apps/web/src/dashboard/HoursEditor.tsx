import { useState } from "react";
import { describeError } from "../api/client";
import { useSetWorkingHours } from "../api/hooks";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { dayProblem, fromWeek, nextRange, timeLabel, timeOptions, toWeek, WEEKDAYS, type HoursBlock, type TimeRange, type Week } from "./hours";

const STARTS = timeOptions("start");
const ENDS = timeOptions("end");

/**
 * The whole week is edited here and saved in one go (the API replaces the week as a unit,
 * in a transaction, so customers never see a half-saved schedule).
 */
export function HoursEditor({ businessId, staffId, saved, timezone }: { businessId: string; staffId: string; saved: HoursBlock[]; timezone: string }) {
  const setHours = useSetWorkingHours(businessId, staffId);
  const [week, setWeek] = useState<Week>(() => toWeek(saved));
  const [justSaved, setJustSaved] = useState(false);

  const problems = Object.fromEntries(WEEKDAYS.map((d) => [d.weekday, dayProblem(week[d.weekday] ?? [])]));
  const hasProblem = Object.values(problems).some(Boolean);
  const changed = JSON.stringify(fromWeek(week)) !== JSON.stringify(fromWeek(toWeek(saved)));

  function update(weekday: number, ranges: TimeRange[]) {
    setWeek((w) => ({ ...w, [weekday]: ranges }));
    setJustSaved(false);
  }

  function copyMondayToWeekdays() {
    const monday = week[1] ?? [];
    setWeek((w) => ({ ...w, 2: [...monday], 3: [...monday], 4: [...monday], 5: [...monday] }));
    setJustSaved(false);
  }

  function save() {
    setHours.mutate(fromWeek(week), { onSuccess: () => setJustSaved(true) });
  }

  return (
    <div>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {WEEKDAYS.map((day) => {
          const ranges = week[day.weekday] ?? [];
          const open = ranges.length > 0;
          const add = nextRange(ranges);
          return (
            <li key={day.weekday} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
              <label className="flex w-32 shrink-0 items-center gap-2 pt-2.5 text-[15px]">
                <input type="checkbox" className="size-4 accent-accent" checked={open} onChange={(e) => update(day.weekday, e.target.checked ? [nextRange([])!] : [])} />
                <span className={open ? "font-medium" : "text-ink-3"}>{day.long}</span>
              </label>

              <div className="min-w-0 flex-1 space-y-2">
                {!open && <p className="pt-2.5 text-[15px] text-ink-3">Closed</p>}
                {ranges.map((range, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <TimeSelect label={`${day.long} opening time ${i + 1}`} value={range.start} options={STARTS} onChange={(start) => update(day.weekday, ranges.map((r, j) => (j === i ? { ...r, start } : r)))} />
                    <span className="text-ink-3" aria-hidden="true">–</span>
                    <TimeSelect label={`${day.long} closing time ${i + 1}`} value={range.end} options={ENDS} onChange={(end) => update(day.weekday, ranges.map((r, j) => (j === i ? { ...r, end } : r)))} />
                    <button
                      type="button"
                      onClick={() => update(day.weekday, ranges.filter((_, j) => j !== i))}
                      className="grid size-9 shrink-0 place-items-center rounded-control text-ink-3 hover:bg-sunken hover:text-ink"
                      aria-label={`Remove ${day.long} ${timeLabel(range.start)} to ${timeLabel(range.end)}`}
                    >
                      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                ))}
                {open && add && (
                  <button type="button" onClick={() => update(day.weekday, [...ranges, add])} className="text-sm font-medium text-accent hover:underline">
                    + Add more hours (after a break)
                  </button>
                )}
                {problems[day.weekday] && <p className="text-sm text-danger">{problems[day.weekday]}</p>}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-sm text-ink-3">Times are in the salon's timezone ({timezone.replaceAll("_", " ")}). Bookings already made aren't moved when hours change.</p>

      {setHours.isError && <Notice tone="error" className="mt-3">{describeError(setHours.error)}</Notice>}
      {justSaved && !changed && <Notice tone="success" className="mt-3">Hours saved. Customers now see these times.</Notice>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={save} loading={setHours.isPending} disabled={!changed || hasProblem}>
          Save hours
        </Button>
        {(week[1] ?? []).length > 0 && (
          <Button onClick={copyMondayToWeekdays}>Copy Monday to Tue–Fri</Button>
        )}
      </div>
    </div>
  );
}

function TimeSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-2 text-[15px] text-ink sm:w-32 sm:flex-none">
      {options.map((time) => (
        <option key={time} value={time}>
          {timeLabel(time)}
        </option>
      ))}
    </select>
  );
}
