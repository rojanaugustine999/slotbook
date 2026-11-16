import { useState } from "react";
import { useSearchParams } from "react-router";
import { describeError } from "../api/client";
import { useStats } from "../api/hooks";
import { cn } from "../lib/cn";
import { todayIn } from "../lib/dates";
import { formatPrice } from "../lib/money";
import { Spinner } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { BookingsChart } from "./BookingsChart";
import { formatPercent } from "./chart";
import { useDashboardBusiness } from "./DashboardLayout";
import { formatRange, matchPreset, PRESETS, presetRange, rangeDays, validateRange } from "./ranges";
import { MetricCard, OutcomeList, Panel, TopServices } from "./StatsParts";
import { useNow } from "./useNow";

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function StatsPage() {
  const business = useDashboardBusiness();
  const today = todayIn(business.timezone, useNow());

  // The chosen range lives in the address (?from=...&to=...), so it survives a reload and can be shared.
  const [params, setParams] = useSearchParams();
  const fallback = presetRange("30d", today);
  const asDate = (value: string | null) => (value && DATE_FORMAT.test(value) ? value : null);
  const from = asDate(params.get("from")) ?? fallback.from;
  const to = asDate(params.get("to")) ?? fallback.to;

  const problem = validateRange(from, to);
  const stats = useStats(business.id, from, to, problem === null);

  const matched = matchPreset(from, to, today);
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || matched === null;

  function applyRange(range: { from: string; to: string }) {
    setParams({ from: range.from, to: range.to });
  }

  const data = stats.data;
  const booked = data ? data.total - data.byStatus.cancelled : 0; // cancelled bookings aren't "bookings" for this headline
  const finished = data ? data.byStatus.completed + data.byStatus.no_show : 0;
  const refreshing = stats.isPlaceholderData || (stats.isFetching && !stats.isPending);

  return (
    <div>
      {/* Which period */}
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
          {PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              selected={matched === preset.id && !customOpen}
              onClick={() => {
                setCustomOpen(false);
                applyRange(presetRange(preset.id, today));
              }}
            >
              {preset.label}
            </Chip>
          ))}
          <Chip selected={showCustom} onClick={() => setCustomOpen(true)}>
            Custom
          </Chip>
        </div>

        {showCustom && (
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <div className="w-40">
              <Field label="From" type="date" value={from} max={to} onChange={(e) => e.target.value && applyRange({ from: e.target.value, to })} />
            </div>
            <div className="w-40">
              <Field label="To" type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && applyRange({ from, to: e.target.value })} />
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-lg font-medium" aria-live="polite">
          {formatRange(from, to)}
        </h2>
        {!problem && <span className="text-sm text-ink-3">{rangeDays(from, to)} days</span>}
        {!problem && refreshing && <Spinner className="self-center text-ink-3" />}
      </div>

      {problem ? (
        <Notice tone="error">{problem}</Notice>
      ) : stats.isPending ? (
        <div className="flex justify-center py-24 text-ink-3">
          <Spinner className="size-6" />
        </div>
      ) : stats.isError ? (
        <Notice tone="error">{describeError(stats.error)}</Notice>
      ) : (
        data && (
          <div className={cn("space-y-6 transition-opacity", refreshing && "opacity-60")}>
            {data.total === 0 && <Notice>No bookings in this period yet.</Notice>}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Bookings" value={String(booked)} hint={data.byStatus.cancelled > 0 ? `${data.byStatus.cancelled} cancelled` : undefined} />
              <MetricCard label="Completed" value={String(data.byStatus.completed)} hint={data.byStatus.confirmed + data.byStatus.pending > 0 ? `${data.byStatus.confirmed + data.byStatus.pending} still to come` : undefined} />
              <MetricCard
                label="No-show rate"
                value={data.noShowRate === null ? "–" : formatPercent(data.noShowRate)}
                hint={data.noShowRate === null ? "No finished appointments yet" : `${data.byStatus.no_show} of ${finished} finished`}
              />
              <MetricCard label="Revenue" value={formatPrice(data.revenueCents)} hint="From completed bookings" />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <Panel title="Bookings per day">
                <BookingsChart data={data.bookingsPerDay} today={today} />
              </Panel>
              <Panel title="How bookings ended">
                <OutcomeList byStatus={data.byStatus} total={data.total} />
              </Panel>
            </div>

            <Panel title="Top services">
              <TopServices services={data.topServices} />
            </Panel>
          </div>
        )
      )}
    </div>
  );
}
