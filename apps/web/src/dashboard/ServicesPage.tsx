import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, describeError } from "../api/client";
import { useSaveService, useServices, useSetServiceActive } from "../api/hooks";
import type { OwnerService } from "../api/types";
import { formatDuration, formatPrice, parsePrice, priceInputValue } from "../lib/money";
import { Button, Spinner } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useDashboardBusiness } from "./DashboardLayout";

// Owners pick a length from a list instead of typing minutes: fewer mistakes, and every
// value is one the API accepts (5 to 480 minutes).
const DURATIONS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 420, 480];
const BUFFERS = [0, 5, 10, 15, 20, 30, 45, 60];

/** /dashboard/:businessId/services */
export function ServicesPage() {
  const business = useDashboardBusiness();
  const services = useServices(business.id);
  const setActive = useSetServiceActive(business.id);
  // null = dialog closed, "new" = adding, a service = editing that one
  const [editing, setEditing] = useState<OwnerService | "new" | null>(null);

  if (services.isPending) return <div className="flex justify-center py-16 text-ink-3"><Spinner className="size-6" /></div>;
  if (services.isError) return <Notice tone="error">{describeError(services.error)}</Notice>;

  const shown = services.data.filter((s) => s.active);
  const hidden = services.data.filter((s) => !s.active);

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Services</h2>
          <p className="text-[15px] text-ink-2">What customers can book, how long it takes and what it costs.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          Add service
        </Button>
      </div>

      {setActive.isError && <Notice tone="error" className="mb-4">{describeError(setActive.error)}</Notice>}

      {shown.length === 0 ? (
        <Notice>
          {hidden.length > 0
            ? "Customers can't book anything right now. Show a hidden service again, or add a new one."
            : 'No services yet. Add what you offer, for example "Haircut, 45 min, ₹500".'}
        </Notice>
      ) : (
        <ServiceList services={shown}>
          {(service) => (
            <>
              <Button variant="ghost" onClick={() => setEditing(service)} aria-label={`Edit ${service.name}`}>
                Edit
              </Button>
              {/* Hiding is easy to undo (below), so it needs no "are you sure?" */}
              <Button variant="ghost" onClick={() => setActive.mutate({ id: service.id, active: false })} disabled={setActive.isPending} aria-label={`Hide ${service.name}`}>
                Hide
              </Button>
            </>
          )}
        </ServiceList>
      )}

      {hidden.length > 0 && (
        <section className="mt-8">
          <h3 className="text-[15px] font-medium">Hidden</h3>
          <p className="mb-3 text-sm text-ink-2">Customers can't book these. Bookings already made for them still happen.</p>
          <ServiceList services={hidden} muted>
            {(service) => (
              <Button variant="ghost" onClick={() => setActive.mutate({ id: service.id, active: true })} disabled={setActive.isPending} aria-label={`Show ${service.name} again`}>
                Show again
              </Button>
            )}
          </ServiceList>
        </section>
      )}

      {/* The key resets the form each time the dialog opens for a different service. */}
      <ServiceDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        businessId={business.id}
        service={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function ServiceList({ services, muted, children }: { services: OwnerService[]; muted?: boolean; children: (service: OwnerService) => ReactNode }) {
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-surface">
      {services.map((service) => (
        <li key={service.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <div className={muted ? "min-w-0 flex-1 text-ink-3" : "min-w-0 flex-1"}>
            <p className="font-medium">{service.name}</p>
            <p className="text-sm text-ink-2">
              {formatDuration(service.durationMin)} · {formatPrice(service.priceCents)}
              {service.bufferMin > 0 && <span className="text-ink-3"> · {service.bufferMin} min cleanup</span>}
            </p>
          </div>
          <div className="-mr-2 flex gap-1">{children(service)}</div>
        </li>
      ))}
    </ul>
  );
}

type Fields = "name" | "durationMin" | "bufferMin" | "priceCents";
type Errors = Partial<Record<Fields, string>>;

function ServiceDialog({ businessId, service, open, onClose }: { businessId: string; service: OwnerService | null; open: boolean; onClose: () => void }) {
  const save = useSaveService(businessId);
  const [name, setName] = useState(service?.name ?? "");
  const [durationMin, setDurationMin] = useState(service?.durationMin ?? 30);
  const [bufferMin, setBufferMin] = useState(service?.bufferMin ?? 0);
  const [price, setPrice] = useState(service ? priceInputValue(service.priceCents) : "");
  const [errors, setErrors] = useState<Errors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const priceCents = parsePrice(price);
    const found: Errors = {};
    if (name.trim().length < 2) found.name = "Enter a name, like Haircut.";
    if (priceCents === null) found.priceCents = "Enter a price in rupees, like 500 or 199.50.";
    setErrors(found);
    if (priceCents === null || Object.keys(found).length > 0) return;

    save.mutate(
      { id: service?.id, input: { name: name.trim(), durationMin, bufferMin, priceCents } },
      {
        onSuccess: onClose,
        onError: (error) => {
          // Field problems from the API go beside their fields; anything else shows below the form.
          if (error instanceof ApiError && error.code === "VALIDATION_ERROR" && error.details) {
            setErrors(Object.fromEntries(Object.entries(error.details).map(([field, messages]) => [field, messages[0]])) as Errors);
          }
        },
      },
    );
  }

  const apiFieldError = save.error instanceof ApiError && save.error.code === "VALIDATION_ERROR";

  return (
    <Dialog open={open} onClose={onClose} title={service ? `Edit ${service.name}` : "Add a service"}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={100} placeholder="Haircut" autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <Select label="Length" value={durationMin} onChange={setDurationMin} options={withCurrent(DURATIONS, durationMin)} format={formatDuration} error={errors.durationMin} />
          <Field label="Price (₹)" value={price} onChange={(e) => setPrice(e.target.value)} error={errors.priceCents} inputMode="decimal" placeholder="500" />
        </div>

        <Select
          label="Cleanup time after"
          value={bufferMin}
          onChange={setBufferMin}
          options={withCurrent(BUFFERS, bufferMin)}
          format={(m) => (m === 0 ? "None" : `${m} min`)}
          error={errors.bufferMin}
          hint="Keeps the next booking from starting straight away. Customers don't see it."
        />

        {service && <p className="text-sm text-ink-3">A new length applies to new bookings. Bookings already made keep their times.</p>}

        {save.isError && !apiFieldError && <Notice tone="error">{describeError(save.error)}</Notice>}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {service ? "Save" : "Add service"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The list, plus the current value if an older service uses one that isn't in it. */
function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

function Select({ label, value, onChange, options, format, error, hint }: { label: string; value: number; onChange: (value: number) => void; options: number[]; format: (value: number) => string; error?: string; hint?: string }) {
  const id = `select-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-describedby={error || hint ? `${id}-help` : undefined}
        aria-invalid={error ? true : undefined}
        className={`h-11 w-full rounded-control border bg-surface px-3 text-[15px] text-ink ${error ? "border-danger" : "border-line-strong"}`}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {format(option)}
          </option>
        ))}
      </select>
      {(error || hint) && (
        <p id={`${id}-help`} className={`mt-1.5 text-sm ${error ? "text-danger" : "text-ink-3"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
