import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { useAuthDialog } from "./auth/AuthDialog";
import { cn } from "./lib/cn";
import { Button } from "./ui/Button";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <rect x="7" y="9" width="18" height="16" rx="3" fill="none" stroke="white" strokeWidth="2" />
      <path d="M7 14h18M12 6v5M20 6v5" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Layout() {
  const { status, user, signOut } = useAuth();
  const openAuth = useAuthDialog();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 text-[17px] font-medium">
            <Logo />
            SlotBook
          </Link>
          <nav className="flex items-center gap-1" aria-label="Main">
            {status === "signedIn" && user && (
              <>
                <NavLink to="/me" className={({ isActive }) => cn("rounded-control px-3 py-2 text-[15px]", isActive ? "bg-sunken font-medium" : "text-ink-2 hover:bg-sunken hover:text-ink")}>
                  My bookings
                </NavLink>
                <Button variant="ghost" className="h-10 px-3" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </>
            )}
            {status === "signedOut" && (
              <Button variant="ghost" className="h-10 px-3" onClick={() => openAuth()}>
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
