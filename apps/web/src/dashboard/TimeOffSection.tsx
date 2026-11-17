import { useState, type FormEvent } from "react";
import { describeError } from "../api/client";
import { useAddTimeOff, useDeleteTimeOff, useTimeOff } from "../api/hooks";
import { todayIn } from "../lib/dates";
import { Button, Spinner } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { formatTimeOff, timeOffMoments } from "./timeOff";

/** Upcoming leave and holidays for one person, and a form to add more. */
export function TimeOffSection({ businessId, staffId, timezone }: { businessId: string; staffId: string; timezone: string }) {
  const list = useTimeOff(businessId, staffId);
  const add = useAddTimeOff(businessId, staffId);
  const remove = useDeleteTimeOff(businessId, staffId);

  const today = todayIn(timezone); // the salon's today, not the laptop's
  const [form, setForm] = useState({ fromDate: today, untilDate: today, wholeDays: true, fromTime: "13:00", untilTime: "18:00", reason: "" });
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const moments = timeOffMoments(form, timezone);
    if ("problem" in moments) return setProblem(moments.problem);
    setProblem(null);
    add.mutate(
      { ...moments, reason: form.reason.trim() || undefined },
      { onSuccess: () => setForm((f) => ({ ...f, reason: "" })), onError: (e) => setProblem(describeError(e)) },
    );
  }

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div>
      {list.isPending ? (
        <Spinner className="size-5 text-ink-3" />
      ) : list.isError ? (
        <Notice tone="error">{describeError(list.error)}</Notice>
      ) : list.data.length === 0 ? (
        <p className="text-[15px] text-ink-3">No time off coming up.</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {list.data.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">{formatTimeOff(t.startsAt, t.endsAt, timezone)}</p>
                {t.reason && <p className="text-sm text-ink-2">{t.reason}</p>}
              </div>
              <Button variant="ghost" className="-mr-2" onClick={() => remove.mutate(t.id)} disabled={remove.isPending} aria-label={`Remove time off ${formatTimeOff(t.startsAt, t.endsAt, timezone)}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} noValidate className="mt-4 space-y-3 rounded-card border border-line bg-surface p-4">
        <p className="text-[15px] font-medium">Add time off</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" type="date" min={today} value={form.fromDate} onChange={(e) => set({ fromDate: e.target.value, untilDate: e.target.value > form.untilDate ? e.target.value : form.untilDate })} />
          <Field label="Until" type="date" min={form.fromDate} value={form.untilDate} onChange={(e) => set({ untilDate: e.target.value })} />
        </div>

        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" className="size-4 accent-accent" checked={form.wholeDays} onChange={(e) => set({ wholeDays: e.target.checked })} />
          Whole days
        </label>

        {!form.wholeDays && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starting at" type="time" step={900} value={form.fromTime} onChange={(e) => set({ fromTime: e.target.value })} />
            <Field label="Back at" type="time" step={900} value={form.untilTime} onChange={(e) => set({ untilTime: e.target.value })} />
          </div>
        )}

        <Field label="Reason (optional, only you see it)" value={form.reason} onChange={(e) => set({ reason: e.target.value })} maxLength={200} placeholder="Annual leave" />

        {problem && <Notice tone="error">{problem}</Notice>}
        <p className="text-sm text-ink-3">Customers can't book this person during the time off. Bookings already made in that time aren't cancelled, so check the calendar.</p>

        <Button type="submit" variant="primary" loading={add.isPending}>
          Add time off
        </Button>
      </form>
    </div>
  );
}
