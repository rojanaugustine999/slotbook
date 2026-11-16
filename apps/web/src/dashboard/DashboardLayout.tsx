import { Navigate, NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router";
import { describeError } from "../api/client";
import { useMyBusinesses } from "../api/hooks";
import type { OwnedBusiness } from "../api/types";
import { useAuthDialog } from "../auth/AuthDialog";
import { useAuth } from "../auth/AuthProvider";
import { cn } from "../lib/cn";
import { Button, Spinner } from "../ui/Button";
import { Notice } from "../ui/Notice";

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
    <NavLink to={to} className={({ isActive }) => cn("-mb-px border-b-2 px-3 py-2 text-[15px]", isActive ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
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

  if (status === "loading") return <Centered><Spinner className="size-6" /></Centered>;

  if (status === "signedOut") {
    return (
      <Centered>
        <h1 className="text-xl font-medium">Owner dashboard</h1>
        <p className="mt-2 text-ink-2">Sign in with your business account to see your calendar.</p>
        <Button variant="primary" className="mt-5" onClick={() => openAuth({ reason: "Sign in to open your dashboard." })}>
          Sign in
        </Button>
      </Centered>
    );
  }

  if (businesses.isPending) return <Centered><Spinner className="size-6" /></Centered>;
  if (businesses.isError) return <Notice tone="error">{describeError(businesses.error)}</Notice>;

  if (businesses.data.length === 0) {
    return (
      <Centered>
        <h1 className="text-xl font-medium">No business yet</h1>
        <p className="mt-2 text-ink-2">This account doesn't manage a business. Customers can see their appointments under "My bookings".</p>
      </Centered>
    );
  }

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
            <h1 className="text-2xl font-medium">Your businesses</h1>
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
              </div>
            </div>
            <nav className="mb-6 flex gap-1 border-b border-line" aria-label="Dashboard sections">
              <TabLink to="calendar">Calendar</TabLink>
              <TabLink to="stats">Stats</TabLink>
            </nav>
            <Outlet context={{ business } satisfies DashboardContext} />
          </div>
        );
      }}
    </DashboardGate>
  );
}
