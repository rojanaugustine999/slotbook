import { Link, NavLink, Outlet } from "react-router";
import { useMyBusinesses } from "./api/hooks";
import { useAuth } from "./auth/AuthProvider";
import { useAuthDialog } from "./auth/AuthDialog";
import { cn } from "./lib/cn";
import { Button } from "./ui/Button";

// The logo: a week of time slots as a 3x3 grid, with one booked (the coral one).
const SLOT_POSITIONS = [7, 13.5, 20];

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-brand-teal" />
      {SLOT_POSITIONS.flatMap((y) =>
        SLOT_POSITIONS.map((x) => {
          const booked = x === 13.5 && y === 13.5;
          return <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" rx="1.5" className={booked ? "fill-brand-slot" : "fill-white/35"} />;
        }),
      )}
    </svg>
  );
}

/** "Slot" in ink, "Book" in the brand coral: the word customers come here to do gets the colour. */
export function Wordmark() {
  return (
    <span className="tracking-[-0.01em]">
      Slot<span className="text-brand-coral">Book</span>
    </span>
  );
}

export function Layout() {
  const { status, user, signOut } = useAuth();
  const openAuth = useAuthDialog();
  const businesses = useMyBusinesses();
  const isOwner = (businesses.data?.length ?? 0) > 0; // only owners see the Dashboard link

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 text-[17px] font-medium">
            <Logo />
            {/* The word is dropped on phones, so the navigation has room. The logo is still a link home. */}
            <span className="hidden sm:inline">
              <Wordmark />
            </span>
            <span className="sr-only sm:hidden">SlotBook home</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Main">
            {status === "signedIn" && user && (
              <>
                {isOwner && (
                  <NavLink to="/dashboard" className={({ isActive }) => cn("whitespace-nowrap rounded-control px-2.5 py-2 text-[15px] sm:px-3", isActive ? "bg-sunken font-medium" : "text-ink-2 hover:bg-sunken hover:text-ink")}>
                    Dashboard
                  </NavLink>
                )}
                <NavLink to="/me" className={({ isActive }) => cn("whitespace-nowrap rounded-control px-2.5 py-2 text-[15px] sm:px-3", isActive ? "bg-sunken font-medium" : "text-ink-2 hover:bg-sunken hover:text-ink")}>
                  My bookings
                </NavLink>
                <NavLink to="/account" className={({ isActive }) => cn("whitespace-nowrap rounded-control px-2.5 py-2 text-[15px] sm:px-3", isActive ? "bg-sunken font-medium" : "text-ink-2 hover:bg-sunken hover:text-ink")}>
                  Account
                </NavLink>
                {/* SlotBook staff only. Hiding the link is just tidiness: the API checks every admin request itself.
                    On phones, Admin and Sign out live on the Account page instead: five links don't fit
                    on a 375px screen, and the header would scroll sideways. */}
                {user.isPlatformAdmin && (
                  <NavLink to="/admin" className={({ isActive }) => cn("hidden whitespace-nowrap rounded-control px-2.5 py-2 text-[15px] sm:block sm:px-3", isActive ? "bg-sunken font-medium" : "text-ink-2 hover:bg-sunken hover:text-ink")}>
                    Admin
                  </NavLink>
                )}
                <Button variant="ghost" className="hidden h-10 px-2.5 sm:inline-flex sm:px-3" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </>
            )}
            {status === "signedOut" && (
              <Button variant="ghost" className="h-10 px-2.5 sm:px-3" onClick={() => openAuth()}>
                Sign in
              </Button>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
