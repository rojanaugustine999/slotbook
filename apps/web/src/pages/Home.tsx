import { Link } from "react-router";
import { describeError } from "../api/client";
import { usePublicBusinesses } from "../api/hooks";
import type { PublicBusinessCard } from "../api/types";
import { Spinner } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { WakingUp } from "../ui/WakingUp";

// The demo salon from the seed data gets a small "Demo" tag, so visitors know it's sample data.
const DEMO_SLUG = "glow-salon";

/** "Glow Salon" → "GS": the round avatar on each card. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

export function Home() {
  const salons = usePublicBusinesses();

  return (
    <div className="mx-auto max-w-xl py-10 text-center sm:py-20">
      <h1 className="text-3xl font-medium leading-tight tracking-tight sm:text-4xl">Book your next appointment in a few taps</h1>
      <p className="mt-4 text-[17px] text-ink-2">Pick a service, choose a time that works, and get a confirmation by email. No phone calls.</p>

      <section aria-label="Salons taking bookings" className="mt-10 text-left">
        {salons.isPending ? (
          <div className="flex flex-col items-center py-6 text-ink-3">
            <Spinner className="size-6" />
            <WakingUp />
          </div>
        ) : salons.isError ? (
          <Notice tone="error">{describeError(salons.error)}</Notice>
        ) : salons.data.length === 0 ? (
          <Notice>No salons are taking bookings yet.</Notice>
        ) : (
          <ul className="space-y-3">
            {salons.data.map((salon) => (
              <li key={salon.slug}>
                <SalonCard salon={salon} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-[15px] text-ink-2">
        Run a salon or clinic?{" "}
        <Link to="/dashboard/new" className="font-medium text-accent underline underline-offset-2">
          Set up your booking page
        </Link>
      </p>
    </div>
  );
}

function SalonCard({ salon }: { salon: PublicBusinessCard }) {
  const details = [salon.address, salon.services.join(", ")].filter(Boolean).join(" · ");
  return (
    <Link to={`/${salon.slug}`} className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:bg-sunken">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-soft font-medium text-accent-ink" aria-hidden="true">
        {initials(salon.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{salon.name}</span>
          {salon.slug === DEMO_SLUG && <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-xs text-ink-2">Demo</span>}
        </span>
        {details && <span className="block truncate text-sm text-ink-2">{details}</span>}
      </span>
      <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}

export function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-xl font-medium">Page not found</h1>
      <p className="mt-2 text-ink-2">That address doesn't lead anywhere.</p>
      <Link to="/" className="mt-6 inline-block font-medium text-accent underline underline-offset-2">
        Go to the home page
      </Link>
    </div>
  );
}
