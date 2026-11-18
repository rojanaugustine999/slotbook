import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, describeError } from "../api/client";
import { useAdminBalances, useAuditLog, useOpenRefunds, useRecordPayout, useRetryRefund } from "../api/hooks";
import type { AuditEntry, SalonBalance } from "../api/types";
import { useAuthDialog } from "../auth/AuthDialog";
import { useAuth } from "../auth/AuthProvider";
import { formatPrice, parsePrice, priceInputValue } from "../lib/money";
import { Button, Spinner } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { NotFound } from "./Home";

// ─── SlotBook's own admin area ───────────────────────────────────────────────
// What SlotBook owes each salon, refunds that need a push, and a log of every admin action.
// The API decides who gets in: anyone else gets 404, and this page then shows "not found".
// ──────────────────────────────────────────────────────────────────────────────

export function AdminPage() {
  const { status } = useAuth();
  const openAuth = useAuthDialog();
  const balances = useAdminBalances();

  if (status === "loading") return <Centered><Spinner className="size-6" /></Centered>;
  if (status === "signedOut") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <h1 className="text-xl font-medium">Sign in to continue</h1>
        <Button variant="primary" className="mt-5" onClick={() => openAuth({ reason: "Sign in to continue." })}>Sign in</Button>
      </div>
    );
  }
  if (balances.error instanceof ApiError && balances.error.status === 404) return <NotFound />;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <h1 className="text-2xl font-medium">SlotBook admin</h1>
      <Balances />
      <Refunds />
      <AuditLog />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[17px] font-medium">{title}</h2>
      <p className="mb-3 text-sm text-ink-2">{hint}</p>
      {children}
    </section>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex justify-center py-20">{children}</div>;
}

// ─── Balances and payouts ───────────────────────────────────────────────────

function Balances() {
  const balances = useAdminBalances();
  const [payingOut, setPayingOut] = useState<SalonBalance | null>(null);

  return (
    <Section title="What SlotBook owes salons" hint="Kept deposits, minus SlotBook's 10% commission and what has already been paid out.">
      {balances.isPending ? (
        <Spinner className="size-5 text-ink-3" />
      ) : balances.isError ? (
        <Notice tone="error">{describeError(balances.error)}</Notice>
      ) : balances.data.length === 0 ? (
        <Empty>No salon has taken a deposit yet.</Empty>
      ) : (
        <ul className="space-y-3">
          {balances.data.map((salon) => (
            <li key={salon.id} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{salon.name}</p>
                <p className="text-sm text-ink-2">
                  Deposits {formatPrice(salon.totals.deposit)} · commission {formatPrice(-salon.totals.commission)} · refunded {formatPrice(-salon.totals.refund)} · paid out{" "}
                  {formatPrice(-salon.totals.payout)}
                </p>
              </div>
              <div className="flex items-center gap-3 sm:shrink-0">
                <p className="text-right">
                  <span className="block text-xs text-ink-3">Owed now</span>
                  <span className="font-medium">{formatPrice(salon.balanceCents)}</span>
                </p>
                <Button className="h-10" disabled={salon.balanceCents <= 0} onClick={() => setPayingOut(salon)}>
                  Record payout
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {payingOut && <PayoutDialog salon={payingOut} onClose={() => setPayingOut(null)} />}
    </Section>
  );
}

function PayoutDialog({ salon, onClose }: { salon: SalonBalance; onClose: () => void }) {
  const record = useRecordPayout();
  const [amount, setAmount] = useState(priceInputValue(salon.balanceCents)); // usually the whole balance
  const [reference, setReference] = useState("");
  const [amountError, setAmountError] = useState<string>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = parsePrice(amount);
    if (!amountCents) return setAmountError("Enter an amount in rupees, like 2160 or 54.50.");
    if (amountCents > salon.balanceCents) return setAmountError(`That's more than the ${formatPrice(salon.balanceCents)} owed.`);
    setAmountError(undefined);
    record.mutate({ businessId: salon.id, amountCents, reference: reference.trim() || undefined }, { onSuccess: onClose });
  }

  return (
    <Dialog open onClose={onClose} title={`Payout to ${salon.name}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-[15px] text-ink-2">Record a bank transfer you've already made. This only updates SlotBook's books; it doesn't send money.</p>
        <Field label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amountError} />
        <Field label="Transfer reference (optional)" placeholder="e.g. the UTR number" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        {record.isError && <Notice tone="error">{describeError(record.error)}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={record.isPending}>Record payout</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Refunds that need attention ────────────────────────────────────────────

const REASON: Record<string, string> = {
  customer_cancelled: "customer cancelled in time",
  salon_cancelled: "salon cancelled",
  hold_expired: "paid after the hold ran out",
};

function Refunds() {
  const refunds = useOpenRefunds();
  const retry = useRetryRefund();

  return (
    <Section title="Refunds needing attention" hint="Refunds Razorpay hasn't finished. Pending ones usually clear on their own; failed ones need a retry.">
      {retry.isError && <Notice tone="error" className="mb-3">{describeError(retry.error)}</Notice>}
      {refunds.isPending ? (
        <Spinner className="size-5 text-ink-3" />
      ) : refunds.isError ? (
        <Notice tone="error">{describeError(refunds.error)}</Notice>
      ) : refunds.data.length === 0 ? (
        <Empty>All refunds are done.</Empty>
      ) : (
        <ul className="space-y-3">
          {refunds.data.map((refund) => (
            <li key={refund.id} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">
                  {formatPrice(refund.amountCents)} · {refund.payment.business.name}
                </p>
                <p className="text-sm text-ink-2">
                  <span className={refund.status === "failed" ? "font-medium text-danger" : undefined}>{refund.status === "failed" ? "Failed" : "Pending"}</span>
                  {" · "}
                  {REASON[refund.reason ?? ""] ?? refund.reason} · {formatDateTime(refund.createdAt)}
                </p>
              </div>
              <Button className="h-10" loading={retry.isPending && retry.variables === refund.id} disabled={retry.isPending} onClick={() => retry.mutate(refund.id)}>
                Retry now
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ─── Audit log ──────────────────────────────────────────────────────────────

function AuditLog() {
  const log = useAuditLog();
  return (
    <Section title="Admin activity" hint="Every admin action, newest first. It can't be edited.">
      {log.isPending ? (
        <Spinner className="size-5 text-ink-3" />
      ) : log.isError ? (
        <Notice tone="error">{describeError(log.error)}</Notice>
      ) : log.data.length === 0 ? (
        <Empty>Nothing yet.</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {log.data.map((entry) => (
            <li key={entry.id} className="px-4 py-3 text-sm">
              <p>{describeAction(entry)}</p>
              <p className="text-ink-3">
                {entry.actor.name} · {formatDateTime(entry.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function describeAction(entry: AuditEntry): string {
  const d = entry.details ?? {};
  if (entry.action === "payout.record") {
    const ref = typeof d.reference === "string" ? ` (ref ${d.reference})` : "";
    return `Recorded a ${formatPrice(Number(d.amountCents ?? 0))} payout${ref}`;
  }
  if (entry.action === "refund.retry") return `Retried a refund${d.previousStatus === "failed" ? " that had failed" : ""}`;
  return entry.action;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-ink-2">{children}</p>;
}

// Shown in the admin's own timezone: these are SlotBook's events, not a salon's appointments.
const formatDateTime = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
