import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { useServices, useStaff } from "../api/hooks";
import type { OwnedBusiness } from "../api/types";
import { cn } from "../lib/cn";
import { Button } from "../ui/Button";
import type { HoursBlock } from "./hours";
import { setupSteps } from "./setup";

/**
 * Shown at the top of the dashboard until the salon can take its first booking.
 * It disappears by itself once everything lines up.
 */
export function SetupChecklist({ business }: { business: OwnedBusiness }) {
  const services = useServices(business.id);
  const staff = useStaff(business.id);

  // Everyone's hours, using the same cache keys as the staff pages, so saving hours
  // there updates this checklist straight away.
  const active = (staff.data ?? []).filter((s) => s.active);
  const hours = useQueries({
    queries: active.map((member) => ({
      queryKey: ["hours", member.id],
      queryFn: async () => (await api<{ hours: HoursBlock[] }>(`/businesses/${business.id}/staff/${member.id}/working-hours`)).hours,
    })),
  });

  if (!services.data || !staff.data) return null;
  const hoursCount = Object.fromEntries(active.map((member, i) => [member.id, hours[i]?.data?.length]));
  const { steps, ready, loading } = setupSteps(services.data, staff.data, hoursCount);
  if (ready || loading) return null;

  const next = steps.find((s) => !s.done);

  return (
    <section aria-labelledby="setup-title" className="mb-6 rounded-card border border-accent/30 bg-accent-soft/40 p-4 sm:p-5">
      <h2 id="setup-title" className="font-medium">Finish setting up to take bookings</h2>
      <p className="text-[15px] text-ink-2">Customers will see times on your booking page once these are done.</p>
      <ol className="mt-3 space-y-2">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-3">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium",
                step.done ? "bg-accent text-on-accent" : step === next ? "border-2 border-accent text-accent-ink" : "border border-line-strong text-ink-3",
              )}
              aria-hidden="true"
            >
              {step.done ? "✓" : i + 1}
            </span>
            <span className={cn("flex-1 text-[15px]", step.done && "text-ink-3 line-through")}>
              {step.label}
              <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
            </span>
            {step === next && (
              <Link to={step.to} className="whitespace-nowrap text-sm font-medium text-accent hover:underline">
                Do this →
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The address customers book at, with Copy and Open. */
export function BookingLink({ slug }: { slug: string }) {
  const url = `${window.location.origin}/${slug}`;
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      // Some browsers block the clipboard (for example on plain http). The address is
      // shown right beside the button, so people can still select it themselves.
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-2">Booking page:</span>
      <a href={`/${slug}`} target="_blank" rel="noreferrer" className="font-medium text-accent underline-offset-2 hover:underline">
        {url.replace(/^https?:\/\//, "")}
      </a>
      <Button variant="secondary" className="h-8 px-3 text-sm" onClick={copy}>
        {copied === "yes" ? "Copied" : "Copy link"}
      </Button>
      <span role="status" className="sr-only">
        {copied === "yes" ? "Booking link copied" : copied === "failed" ? "Couldn't copy. Select the address instead." : ""}
      </span>
      {copied === "failed" && <span className="text-ink-3">Couldn't copy, select the address instead.</span>}
    </div>
  );
}
