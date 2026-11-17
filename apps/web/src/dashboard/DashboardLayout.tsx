import { Link, Navigate, NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router";
import { describeError } from "../api/client";
import { useMyBusinesses } from "../api/hooks";
import type { OwnedBusiness } from "../api/types";
import { useAuthDialog } from "../auth/AuthDialog";
import { useAuth } from "../auth/AuthProvider";
import { cn } from "../lib/cn";
import { Button, Spinner } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { WakingUp } from "../ui/WakingUp";
import { CreateBusiness } from "./CreateBusiness";
import { BookingLink, SetupChecklist } from "./SetupChecklist";

export interface DashboardContext {
  business: OwnedBusiness;
}

/** Pages inside the dashboard read the business they belong to with this. */
export function useDashboardBusiness(): OwnedBusiness {
  return useOutletContext<DashboardContext>().business;
}

// A tab: the current one gets an accent underline. The "to" is relative, so "stats" means
// /dashboard/<this business>/stats.
function TabLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink to={to} className={({ isActive }) => cn("-mb-px whitespace-nowrap border-b-2 px-2.5 py-2 text-[15px] sm:px-3", isActive ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
      {children}
    </NavLink>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">{children}</div>;
}

// Everything under /dashboard needs a signed-in owner. This works out who is asking,
// and which of their businesses the address refers to, before any page is shown.
export function DashboardGate({ children }: { children: (businesses: OwnedBusiness[]) => React.ReactNode }) {
  const { status } = useAuth();
  const openAuth = useAuthDialog();
  const businesses = useMyBusinesses();

  if (status === "loading") return <Centered><Spinner className="size-6" /><WakingUp /></Centered>;

  if (status === "signedOut") {
    return (
      <Centered>
        <h1 className="text-xl font-medium">Owner dashboard</h1>
        <p className="mt-2 text-ink-2">Sign in to see your calendar, or create an account to set up your salon.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={() => openAuth({ reason: "Sign in to open your dashboard." })}>
            Sign in
          </Button>
          <Button onClick={() => openAuth({ mode: "signUp", reason: "Create an account, then set up your salon." })}>Create account</Button>
        </div>
      </Centered>
    );
  }

  if (businesses.isPending) return <Centered><Spinner className="size-6" /><WakingUp /></Centered>;
  if (businesses.isError) return <Notice tone="error">{describeError(businesses.error)}</Notice>;

  // A signed-in person with no salon yet: this is where an owner's setup begins.
  if (businesses.data.length === 0) return <CreateBusiness />;

  return <>{children(businesses.data)}</>;
}

/** /dashboard: straight to the calendar when there is one business, a choice when there are several. */
export function DashboardHome() {
  return (
    <DashboardGate>
      {(businesses) =>
        businesses.length === 1 ? (
          <Navigate to={`/dashboard/${businesses[0]!.id}/calendar`} replace />
        ) : (
          <div className="mx-auto max-w-md">
            <div className="flex items-baseline justify-between gap-3">
              <h1 className="text-2xl font-medium">Your businesses</h1>
              <NewSalonLink />
            </div>
            <ul className="mt-5 space-y-2">
              {businesses.map((business) => (
                <li key={business.id}>
                  <a href={`/dashboard/${business.id}/calendar`} className="block rounded-card border border-line bg-surface p-4 hover:bg-sunken">
                    <span className="font-medium">{business.name}</span>
                    <span className="block text-sm text-ink-2">{business.address ?? business.slug}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )
      }
    </DashboardGate>
  );
}

/**
 * /dashboard/new: set up a salon. The home page's "Set up your booking page" comes here,
 * so it works for everyone: signed out (sign in or create an account first), signed in
 * with no salon, and signed in with salons already (adds another one).
 */
export function DashboardNew() {
  return <DashboardGate>{(businesses) => <CreateBusiness hasOthers={businesses.length > 0} />}</DashboardGate>;
}

function NewSalonLink() {
  return (
    <Link to="/dashboard/new" className="text-sm font-medium text-accent hover:underline">
      + New salon
    </Link>
  );
}

/** /dashboard/:businessId/...: the frame around one business's pages. */
export function DashboardLayout() {
  const { businessId } = useParams();
  const navigate = useNavigate();

  return (
    <DashboardGate>
      {(businesses) => {
        const business = businesses.find((b) => b.id === businessId);
        if (!business) {
          return (
            <Centered>
              <h1 className="text-xl font-medium">We couldn't find that business</h1>
              <p className="mt-2 text-ink-2">It may belong to another account.</p>
            </Centered>
          );
        }
        return (
          <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-ink-2">Dashboard</p>
                {businesses.length > 1 ? (
                  <select
                    aria-label="Business"
                    value={business.id}
                    onChange={(event) => navigate(`/dashboard/${event.target.value}/calendar`)}
                    className="-ml-1 rounded-control border border-transparent bg-transparent py-0.5 pl-1 text-xl font-medium hover:border-line-strong"
                  >
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <h1 className="text-xl font-medium">{business.name}</h1>
                )}
                <div className="mt-1">
                  <BookingLink slug={business.slug} />
                </div>
              </div>
              <NewSalonLink />
            </div>
            <SetupChecklist key={business.id} business={business} />
            <nav className="mb-6 flex gap-1 border-b border-line" aria-label="Dashboard sections">
              <TabLink to="calendar">Calendar</TabLink>
              <TabLink to="stats">Stats</TabLink>
              <TabLink to="services">Services</TabLink>
              <TabLink to="staff">Staff</TabLink>
            </nav>
            <Outlet context={{ business } satisfies DashboardContext} />
          </div>
        );
      }}
    </DashboardGate>
  );
}
