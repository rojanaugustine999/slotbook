// ─── "Is this salon ready to take bookings?" ─────────────────────────────────
// A customer sees times only when ALL of these line up for at least one person:
//   a service that is shown  +  a staff member who is shown  +  who offers that
//   service  +  who has some weekly hours.
// Each step on its own is easy to forget, and the booking page then just says
// "no times", which tells the owner nothing. So the dashboard spells out what's missing.
// ──────────────────────────────────────────────────────────────────────────────

interface Service {
  id: string;
  active: boolean;
}

interface Staff {
  id: string;
  name: string;
  active: boolean;
  services: { id: string }[];
}

export interface SetupStep {
  key: "service" | "staff" | "hours";
  label: string;
  done: boolean;
  /** Where to fix it, relative to /dashboard/:businessId. */
  to: string;
}

/**
 * hoursCount: how many hours blocks each staff member has (undefined while loading).
 * Returns the steps in order, and whether the salon is ready.
 */
export function setupSteps(services: Service[], staff: Staff[], hoursCount: Record<string, number | undefined>) {
  const shownServices = new Set(services.filter((s) => s.active).map((s) => s.id));
  const shownStaff = staff.filter((s) => s.active);
  // People who can actually be booked for something.
  const offering = shownStaff.filter((s) => s.services.some((x) => shownServices.has(x.id)));
  const bookable = offering.filter((s) => (hoursCount[s.id] ?? 0) > 0);

  // Send the owner to the first person who still needs hours, or the staff list.
  const needsHours = offering.find((s) => (hoursCount[s.id] ?? 0) === 0);

  const steps: SetupStep[] = [
    { key: "service", label: "Add a service, with its length and price", done: shownServices.size > 0, to: "services" },
    { key: "staff", label: "Add a person and choose the services they offer", done: offering.length > 0, to: "staff" },
    { key: "hours", label: "Set their weekly hours", done: bookable.length > 0, to: needsHours ? `staff/${needsHours.id}` : "staff" },
  ];

  const loading = offering.some((s) => hoursCount[s.id] === undefined);
  return { steps, ready: bookable.length > 0, loading };
}
