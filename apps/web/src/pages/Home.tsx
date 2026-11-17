import { Link } from "react-router";

// There is no list of businesses yet: each one shares its own booking link
// (slotbook.app/<its-name>). So the home page points at the demo salon.
export function Home() {
  return (
    <div className="mx-auto max-w-xl py-10 text-center sm:py-20">
      <h1 className="text-3xl font-medium leading-tight tracking-tight sm:text-4xl">Book your next appointment in a few taps</h1>
      <p className="mt-4 text-[17px] text-ink-2">Pick a service, choose a time that works, and get a confirmation by email. No phone calls.</p>

      <Link
        to="/glow-salon"
        className="mt-10 flex items-center gap-4 rounded-card border border-line bg-surface p-4 text-left transition-colors hover:bg-sunken"
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-soft font-medium text-accent-ink" aria-hidden="true">
          GS
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Glow Salon</span>
          <span className="block text-sm text-ink-2">MG Road, Kochi · Try the demo</span>
        </span>
        <svg viewBox="0 0 24 24" className="size-5 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>

      <p className="mt-8 text-[15px] text-ink-2">
        Run a salon or clinic?{" "}
        <Link to="/dashboard" className="font-medium text-accent underline underline-offset-2">
          Set up your booking page
        </Link>
      </p>
    </div>
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
