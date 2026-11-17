import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { describeError } from "../api/client";
import { useAddStaff, useStaff, useUpdateStaff, useWorkingHours } from "../api/hooks";
import type { StaffMember } from "../api/types";
import { Button, Spinner } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useDashboardBusiness } from "./DashboardLayout";
import { summarizeWeek, toWeek } from "./hours";

/** /dashboard/:businessId/staff */
export function StaffPage() {
  const business = useDashboardBusiness();
  const staff = useStaff(business.id);
  const update = useUpdateStaff(business.id);

  if (staff.isPending) return <div className="flex justify-center py-16 text-ink-3"><Spinner className="size-6" /></div>;
  if (staff.isError) return <Notice tone="error">{describeError(staff.error)}</Notice>;

  const active = staff.data.filter((s) => s.active);
  const hidden = staff.data.filter((s) => !s.active);

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h2 className="text-lg font-medium">Staff</h2>
        <p className="text-[15px] text-ink-2">The people customers book with: what each one offers, when they work, and their time off.</p>
      </div>

      <AddStaffForm businessId={business.id} />

      {update.isError && <Notice tone="error" className="mt-4">{describeError(update.error)}</Notice>}

      {active.length === 0 ? (
        <Notice className="mt-4">{hidden.length > 0 ? "Everyone is hidden, so customers can't book. Show someone again below, or add a person." : "Add the first person who takes bookings. It can be you."}</Notice>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-surface">
          {active.map((member) => (
            <StaffRow key={member.id} businessId={business.id} member={member} />
          ))}
        </ul>
      )}

      {hidden.length > 0 && (
        <section className="mt-8">
          <h3 className="text-[15px] font-medium">Hidden</h3>
          <p className="mb-3 text-sm text-ink-2">Customers can't book with these people. Their past bookings are kept.</p>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {hidden.map((member) => (
              <li key={member.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 font-medium text-ink-3">{member.name}</span>
                <Button variant="ghost" className="-mr-2" onClick={() => update.mutate({ id: member.id, active: true })} disabled={update.isPending} aria-label={`Show ${member.name} again`}>
                  Show again
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AddStaffForm({ businessId }: { businessId: string }) {
  const add = useAddStaff(businessId);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Enter their name, at least 2 letters.");
    setError(undefined);
    add.mutate(name.trim(), { onSuccess: () => setName(""), onError: (e) => setError(describeError(e)) });
  }

  return (
    <form onSubmit={submit} noValidate className="flex items-start gap-2">
      <div className="flex-1">
        <Field label="Add a person" value={name} onChange={(e) => setName(e.target.value)} error={error} placeholder="Their name, like Priya" maxLength={100} />
      </div>
      <Button type="submit" variant="primary" loading={add.isPending} className="mt-[1.6rem]">
        Add
      </Button>
    </form>
  );
}

// Each row loads that person's hours for the summary. A salon has a handful of staff,
// so a few small requests are fine, and each is cached for the detail page.
function StaffRow({ businessId, member }: { businessId: string; member: StaffMember }) {
  const hours = useWorkingHours(businessId, member.id);
  const noServices = member.services.length === 0;
  const noHours = hours.data !== undefined && hours.data.length === 0;

  return (
    <li>
      <Link to={member.id} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{member.name}</p>
          <p className={`truncate text-sm ${noServices ? "text-danger" : "text-ink-2"}`}>{noServices ? "Offers no services yet" : member.services.map((s) => s.name).join(", ")}</p>
          <p className={`truncate text-sm ${noHours ? "text-danger" : "text-ink-3"}`}>{hours.data ? summarizeWeek(toWeek(hours.data)) : " "}</p>
        </div>
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>
    </li>
  );
}
