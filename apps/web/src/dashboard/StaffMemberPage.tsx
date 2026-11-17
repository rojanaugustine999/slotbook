import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { describeError } from "../api/client";
import { useServices, useSetStaffServices, useStaff, useUpdateStaff, useWorkingHours } from "../api/hooks";
import type { OwnerService, StaffMember } from "../api/types";
import { formatDuration } from "../lib/money";
import { Button, Spinner } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useDashboardBusiness } from "./DashboardLayout";
import { HoursEditor } from "./HoursEditor";
import { TimeOffSection } from "./TimeOffSection";

/** /dashboard/:businessId/staff/:staffId */
export function StaffMemberPage() {
  const business = useDashboardBusiness();
  const { staffId = "" } = useParams();
  const staff = useStaff(business.id);
  const services = useServices(business.id);
  const hours = useWorkingHours(business.id, staffId);

  if (staff.isPending || services.isPending) return <div className="flex justify-center py-16 text-ink-3"><Spinner className="size-6" /></div>;
  if (staff.isError) return <Notice tone="error">{describeError(staff.error)}</Notice>;
  if (services.isError) return <Notice tone="error">{describeError(services.error)}</Notice>;

  const member = staff.data.find((s) => s.id === staffId);
  if (!member) {
    return (
      <Notice>
        We couldn't find that person. <Link to=".." relative="path" className="font-medium underline">Back to staff</Link>
      </Notice>
    );
  }

  return (
    <div className="max-w-2xl">
      <Link to=".." relative="path" className="text-sm font-medium text-accent hover:underline">
        ← All staff
      </Link>
      <Header businessId={business.id} member={member} />

      <div className="mt-8 space-y-10">
        <Section title="Services" description="What customers can book with this person.">
          <ServicesChooser businessId={business.id} member={member} services={services.data.filter((s) => s.active)} />
        </Section>

        <Section title="Weekly hours" description="When this person takes bookings. Untick a day to close it.">
          {hours.isPending ? (
            <Spinner className="size-5 text-ink-3" />
          ) : hours.isError ? (
            <Notice tone="error">{describeError(hours.error)}</Notice>
          ) : (
            // Keyed by person, so moving to someone else starts a fresh editor. Not keyed by the
            // saved week: saving changes that, and a fresh editor would lose the "saved" message.
            <HoursEditor key={member.id} businessId={business.id} staffId={member.id} saved={hours.data} timezone={business.timezone} />
          )}
        </Section>

        <Section title="Time off" description="Holidays, leave or appointments. No bookings are offered during these.">
          <TimeOffSection businessId={business.id} staffId={member.id} timezone={business.timezone} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[17px] font-medium">{title}</h3>
      <p className="mb-3 text-[15px] text-ink-2">{description}</p>
      {children}
    </section>
  );
}

function Header({ businessId, member }: { businessId: string; member: StaffMember }) {
  const update = useUpdateStaff(businessId);
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(member.name);
  const [error, setError] = useState<string>();

  function rename(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Use at least 2 letters.");
    update.mutate({ id: member.id, name: name.trim() }, { onSuccess: () => setRenaming(false), onError: (e) => setError(describeError(e)) });
  }

  function hide() {
    // Easy to undo from the staff list, so no "are you sure?".
    update.mutate({ id: member.id, active: false }, { onSuccess: () => navigate("..", { relative: "path" }) });
  }

  if (renaming) {
    return (
      <form onSubmit={rename} noValidate className="mt-3 flex items-start gap-2">
        <div className="flex-1">
          <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={100} autoFocus />
        </div>
        <Button type="submit" variant="primary" loading={update.isPending} className="mt-[1.6rem]">
          Save
        </Button>
        <Button onClick={() => { setRenaming(false); setName(member.name); setError(undefined); }} className="mt-[1.6rem]">
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-2xl font-medium">{member.name}</h2>
        <Button variant="ghost" onClick={() => setRenaming(true)}>
          Rename
        </Button>
        <Button variant="ghost" onClick={hide} loading={update.isPending}>
          Hide
        </Button>
      </div>
      {/* Without this, a failed Hide looked like a button that did nothing. */}
      {update.isError && <Notice tone="error" className="mt-2">{describeError(update.error)}</Notice>}
    </div>
  );
}

function ServicesChooser({ businessId, member, services }: { businessId: string; member: StaffMember; services: OwnerService[] }) {
  const save = useSetStaffServices(businessId, member.id);
  const savedIds = member.services.map((s) => s.id).sort();
  const [chosen, setChosen] = useState<string[]>(savedIds);
  const changed = JSON.stringify([...chosen].sort()) !== JSON.stringify(savedIds);

  if (services.length === 0) {
    return (
      <Notice>
        Your salon has no services yet. <Link to="../../services" relative="path" className="font-medium underline">Add services</Link> first, then choose them here.
      </Notice>
    );
  }

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {services.map((service) => (
          <li key={service.id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-sunken">
              <input type="checkbox" className="size-4 accent-accent" checked={chosen.includes(service.id)} onChange={() => toggle(service.id)} />
              <span className="flex-1 text-[15px]">{service.name}</span>
              <span className="text-sm text-ink-3">{formatDuration(service.durationMin)}</span>
            </label>
          </li>
        ))}
      </ul>
      {save.isError && <Notice tone="error" className="mt-3">{describeError(save.error)}</Notice>}
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={() => save.mutate(chosen)} loading={save.isPending} disabled={!changed}>
          Save services
        </Button>
        {save.isSuccess && !changed && <span className="text-sm text-success" role="status">Saved</span>}
      </div>
    </div>
  );
}
