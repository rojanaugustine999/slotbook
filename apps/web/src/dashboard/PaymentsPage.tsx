import { useState, type FormEvent } from "react";
import { describeError } from "../api/client";
import { useOwnerPayments, useSaveDepositSettings, useServices } from "../api/hooks";
import type { LedgerEntryType, OwnerPayments } from "../api/types";
import { formatTimeOf, formatWhen } from "../lib/dates";
import { depositFor, formatPrice } from "../lib/money";
import { Button, Spinner } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useDashboardBusiness } from "./DashboardLayout";
import { MetricCard, Panel } from "./StatsParts";

// ─── The owner's Payments tab ────────────────────────────────────────────────
// Deposit settings, what SlotBook owes the salon, and every money movement behind that number.
// ──────────────────────────────────────────────────────────────────────────────

export function PaymentsPage() {
  const business = useDashboardBusiness();
  const payments = useOwnerPayments(business.id);

  if (payments.isPending) return <Spinner className="size-6 text-ink-3" />;
  if (payments.isError) return <Notice tone="error">{describeError(payments.error)}</Notice>;

  return (
    <div className="space-y-6">
      {/* key: start the form again from the saved values whenever they change */}
      <DepositSettings key={`${payments.data.settings.depositPercent}-${payments.data.settings.freeCancelHours}`} settings={payments.data.settings} />
      <Balance data={payments.data} />
      <Ledger data={payments.data} />
    </div>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

function DepositSettings({ settings }: { settings: OwnerPayments["settings"] }) {
  const business = useDashboardBusiness();
  const save = useSaveDepositSettings(business.id);
  const services = useServices(business.id);

  const [on, setOn] = useState(settings.depositPercent !== null);
  const [percent, setPercent] = useState(String(settings.depositPercent ?? 20));
  const [hours, setHours] = useState(String(settings.freeCancelHours));
  const [errors, setErrors] = useState<{ percent?: string; hours?: string }>({});
  const [saved, setSaved] = useState(false);

  const percentNumber = Number(percent);
  const validPercent = Number.isInteger(percentNumber) && percentNumber >= 1 && percentNumber <= 100;
  // A real service makes the example concrete: "Haircut ₹500: ₹100 now, ₹400 at the salon".
  const example = services.data?.find((s) => s.active && s.priceCents >= 100);
  const exampleDeposit = example && validPercent ? depositFor(example.priceCents, percentNumber) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const hoursNumber = Number(hours);
    const found: typeof errors = {};
    if (on && !validPercent) found.percent = "Enter a whole number from 1 to 100.";
    if (!Number.isInteger(hoursNumber) || hoursNumber < 0 || hoursNumber > 720) found.hours = "Enter whole hours from 0 to 720 (30 days).";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaved(false);
    save.mutate({ depositPercent: on ? percentNumber : null, freeCancelHours: hoursNumber }, { onSuccess: () => setSaved(true) });
  }

  return (
    <Panel title="Deposits">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!settings.paymentsAvailable && (
          <Notice>Online payments aren't switched on for SlotBook yet, so no deposit will be charged even if you turn this on.</Notice>
        )}

        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-accent" checked={on} onChange={(e) => { setOn(e.target.checked); setSaved(false); }} />
          <span>
            <span className="block text-[15px] font-medium">Ask for a deposit when customers book</span>
            <span className="block text-sm text-ink-2">Fewer no-shows: the slot is held for 15 minutes while they pay, then confirmed.</span>
          </span>
        </label>

        {on && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Deposit (% of the price)"
              inputMode="numeric"
              value={percent}
              onChange={(e) => { setPercent(e.target.value); setSaved(false); }}
              error={errors.percent}
              hint={example && exampleDeposit ? `${example.name} ${formatPrice(example.priceCents)}: ${formatPrice(exampleDeposit)} now, ${formatPrice(example.priceCents - exampleDeposit)} at the salon.` : undefined}
            />
            <Field
              label="Free cancellation (hours before)"
              inputMode="numeric"
              value={hours}
              onChange={(e) => { setHours(e.target.value); setSaved(false); }}
              error={errors.hours}
              hint={`Cancel earlier: deposit refunded. Later, or a no-show: you keep it, minus SlotBook's ${settings.commissionPercent}%.`}
            />
          </div>
        )}

        <p className="text-sm text-ink-3">Changes apply to new bookings. Existing bookings keep the deposit they were made with.</p>

        {save.isError && <Notice tone="error">{describeError(save.error)}</Notice>}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
          {saved && <span className="text-sm text-ink-2" role="status">Saved</span>}
        </div>
      </form>
    </Panel>
  );
}

// ─── Balance ────────────────────────────────────────────────────────────────

function Balance({ data }: { data: OwnerPayments }) {
  const { totals } = data;
  return (
    <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
      <MetricCard label="SlotBook owes you" value={formatPrice(data.balanceCents)} hint="Paid to you by bank transfer." />
      <MetricCard label="Deposits kept" value={formatPrice(totals.deposit + totals.refund)} hint={`After ${formatPrice(-totals.refund)} refunded`} />
      <MetricCard label="Commission" value={formatPrice(-totals.commission)} hint={`${data.settings.commissionPercent}% of kept deposits`} />
    </div>
  );
}

// ─── Ledger ─────────────────────────────────────────────────────────────────

const LABEL: Record<LedgerEntryType, string> = {
  deposit: "Deposit paid",
  commission: "SlotBook commission",
  refund: "Refunded to customer",
  payout: "Paid out to you",
};

function Ledger({ data }: { data: OwnerPayments }) {
  const business = useDashboardBusiness();
  return (
    <Panel title="Money in and out">
      {data.entries.length === 0 ? (
        <p className="text-sm text-ink-2">Nothing yet. Deposits, refunds and payouts will appear here.</p>
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {data.entries.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[15px]">{LABEL[entry.type]}</p>
                <p className="truncate text-sm text-ink-2">
                  {entry.booking
                    ? `${entry.booking.service.name} · ${entry.booking.customer.name} · ${formatWhen(entry.booking.startsAt, business.timezone)}`
                    : entry.payoutReference
                      ? `Reference ${entry.payoutReference}`
                      : " "}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {/* + for money coming to the salon, − for money going out of its balance */}
                <p className={entry.amountCents > 0 ? "font-medium tabular-nums text-success" : "tabular-nums"}>
                  {entry.amountCents > 0 ? "+" : "−"}
                  {formatPrice(Math.abs(entry.amountCents))}
                </p>
                <p className="text-xs text-ink-3">{formatShortDate(entry.createdAt, business.timezone)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const formatShortDate = (iso: string, timezone: string) =>
  `${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: timezone }).format(new Date(iso))}, ${formatTimeOf(iso, timezone)}`;
