import type { BookingStatus, Stats } from "../api/types";
import { cn } from "../lib/cn";
import { formatPrice } from "../lib/money";

export function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-card border border-line bg-surface p-4 sm:p-5", className)}>
      <h2 className="text-[15px] font-medium">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// How every booking in the range ended up, as rows with a bar each. The colours match the
// status badges and the calendar, so a status looks the same everywhere in the app.
const OUTCOMES: { key: BookingStatus; label: string; bar: string; alwaysShow: boolean }[] = [
  { key: "completed", label: "Completed", bar: "bg-success", alwaysShow: true },
  { key: "confirmed", label: "Upcoming", bar: "bg-accent", alwaysShow: true },
  { key: "pending", label: "Pending", bar: "bg-warn", alwaysShow: false },
  { key: "no_show", label: "No-show", bar: "bg-danger", alwaysShow: true },
  { key: "cancelled", label: "Cancelled", bar: "bg-ink-3", alwaysShow: true },
];

export function OutcomeList({ byStatus, total }: { byStatus: Stats["byStatus"]; total: number }) {
  return (
    <ul className="space-y-3">
      {OUTCOMES.filter((o) => o.alwaysShow || byStatus[o.key] > 0).map((outcome) => {
        const count = byStatus[outcome.key];
        return (
          <li key={outcome.key}>
            <div className="flex justify-between text-sm">
              <span className="text-ink-2">{outcome.label}</span>
              <span className="tabular-nums">{count}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-sunken">
              <div className={cn("h-full rounded-full", outcome.bar)} style={{ width: total === 0 ? 0 : `${(count / total) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TopServices({ services }: { services: Stats["topServices"] }) {
  if (services.length === 0) return <p className="text-sm text-ink-3">No bookings in this period.</p>;
  const most = Math.max(...services.map((s) => s.bookings));

  return (
    <ol className="space-y-4">
      {services.map((service, i) => (
        <li key={service.serviceId}>
          <div className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 truncate text-[15px]">
              <span className="mr-2 text-ink-3 tabular-nums">{i + 1}</span>
              <span className="font-medium">{service.name}</span>
            </span>
            <span className="shrink-0 text-sm text-ink-2 tabular-nums">
              {service.bookings} {service.bookings === 1 ? "booking" : "bookings"} · {formatPrice(service.revenueCents)}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(service.bookings / most) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
