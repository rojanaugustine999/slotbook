import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useAuthDialog } from "../auth/AuthDialog";
import { useAuth } from "../auth/AuthProvider";
import { describeError } from "../api/client";
import { useAvailability, useBusiness, useCreateBooking } from "../api/hooks";
import type { Booking, PublicBusiness } from "../api/types";
import { formatWhen, toStartsAt, upcomingDays } from "../lib/dates";
import { Notice } from "../ui/Notice";
import { Spinner } from "../ui/Button";
import { WakingUp } from "../ui/WakingUp";
import { ANYONE, ServicePicker, StaffPicker } from "./Pickers";
import { DayStrip, SlotPicker } from "./SlotPicker";
import { ConfirmedView, MobileConfirmBar, Summary } from "./Summary";

export function BookingPage() {
  const { slug = "" } = useParams();
  const business = useBusiness(slug);

  if (business.isPending) {
    return (
      <div className="flex flex-col items-center py-24 text-ink-3">
        <Spinner className="size-6" />
        <WakingUp />
      </div>
    );
  }
  if (business.isError) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-medium">We couldn't find that business</h1>
        <p className="mt-2 text-ink-2">Check the address, or ask them for their booking link.</p>
        <Link to="/" className="mt-6 inline-block font-medium text-accent underline underline-offset-2">
          Go to the home page
        </Link>
      </div>
    );
  }
  return <BookingFlow business={business.data} />;
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5 text-[15px] font-medium">
        <span className="grid size-6 place-items-center rounded-full bg-sunken text-xs text-ink-2">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function BookingFlow({ business }: { business: PublicBusiness }) {
  const { status, user } = useAuth();
  const openAuth = useAuthDialog();
  const days = useMemo(() => upcomingDays(business.timezone, 14), [business.timezone]);

  // Start on a service somebody actually offers, so the first thing a visitor sees has times.
  const firstBookable = business.services.find((s) => business.staff.some((m) => m.services.some((x) => x.serviceId === s.id)));
  const [serviceId, setServiceId] = useState((firstBookable ?? business.services[0])?.id ?? "");
  const [staffId, setStaffId] = useState(ANYONE);
  const [date, setDate] = useState(days[0]?.date ?? "");
  const [time, setTime] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const service = business.services.find((s) => s.id === serviceId);
  const staffForService = business.staff.filter((s) => s.services.some((x) => x.serviceId === serviceId));
  const specificStaffId = staffId === ANYONE ? undefined : staffId;

  const availability = useAvailability(business.slug, { serviceId, date, staffId: specificStaffId });
  const createBooking = useCreateBooking(business.slug);

  // If the chosen time vanished (someone else booked it while this page was open), forget it.
  const selectedSlot = availability.data?.slots.find((slot) => slot.time === time);
  const chosenTime = selectedSlot ? time : null;

  const staffLabel = (() => {
    if (specificStaffId) return business.staff.find((s) => s.id === specificStaffId)?.name ?? "";
    if (selectedSlot && selectedSlot.staffIds.length === 1) return business.staff.find((s) => s.id === selectedSlot.staffIds[0])?.name ?? "Anyone available";
    return "Anyone available";
  })();

  const whenLabel = chosenTime ? formatWhen(toStartsAt(date, chosenTime, business.timezone), business.timezone) : null;

  function chooseService(id: string) {
    setServiceId(id);
    setTime(null);
    setError(null);
    // Keep the person if they also offer the new service; otherwise go back to "anyone".
    const offersIt = business.staff.some((s) => s.id === staffId && s.services.some((x) => x.serviceId === id));
    if (!offersIt) setStaffId(ANYONE);
  }

  function submit() {
    if (!service || !chosenTime) return;
    setError(null);
    createBooking.mutate(
      { serviceId, staffId: specificStaffId, startsAt: toStartsAt(date, chosenTime, business.timezone) },
      {
        onSuccess: (booking) => setBooked(booking),
        onError: (err) => {
          setError(describeError(err));
          setTime(null); // the slot is probably gone: make them choose again
        },
      },
    );
  }

  function confirm() {
    // Booking needs an account. Ask for it right here, keeping everything the person picked.
    if (status !== "signedIn") {
      openAuth({ reason: "Sign in to confirm your booking. It only takes a moment.", onSuccess: submit });
      return;
    }
    submit();
  }

  if (booked && user) {
    return <ConfirmedView booking={booked} email={user.email} onBookAnother={() => { setBooked(null); setTime(null); }} />;
  }

  return (
    <div className="pb-24 lg:pb-0">
      <header className="mb-8 flex items-center gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-soft text-lg font-medium text-accent-ink" aria-hidden="true">
          {business.name
            .split(" ")
            .slice(0, 2)
            .map((w) => w[0])
            .join("")}
        </div>
        <div>
          <h1 className="text-2xl font-medium leading-tight">{business.name}</h1>
          {business.address && <p className="text-[15px] text-ink-2">{business.address}</p>}
        </div>
      </header>

      {business.services.length === 0 ? (
        <Notice>This business hasn't added any services yet.</Notice>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
          {/* minmax(0, 1fr) lets the column shrink below its content's width. Plain 1fr would not,
              and the sideways-scrolling day strip would stretch the whole page past the screen. */}
          <div className="min-w-0 space-y-9">
            <Step number={1} title="Choose a service">
              <ServicePicker services={business.services} selectedId={serviceId} onSelect={chooseService} />
            </Step>

            {staffForService.length === 0 ? (
              <Notice>Nobody is taking bookings for this service yet. Please choose another service, or check back soon.</Notice>
            ) : (
              <>
                <Step number={2} title="Who would you like?">
                  <StaffPicker staff={staffForService} selectedId={staffId} onSelect={(id) => { setStaffId(id); setTime(null); }} />
                </Step>

                <Step number={3} title="Pick a day">
                  <DayStrip days={days} selected={date} onSelect={(d) => { setDate(d); setTime(null); }} />
                </Step>

                <Step number={4} title="Pick a time">
                  <SlotPicker slots={availability.data?.slots} loading={availability.isPending && availability.fetchStatus !== "idle"} error={availability.isError} selectedTime={chosenTime} onSelect={setTime} />
                </Step>
              </>
            )}

            {error && <Notice tone="error">{error}</Notice>}
          </div>

          {service && (
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <Summary
                serviceName={service.name}
                durationMin={service.durationMin}
                priceCents={service.priceCents}
                staffLabel={staffLabel}
                whenLabel={whenLabel}
                busy={createBooking.isPending}
                onConfirm={confirm}
              />
            </aside>
          )}
        </div>
      )}

      {service && whenLabel && <MobileConfirmBar serviceName={service.name} whenLabel={whenLabel} busy={createBooking.isPending} onConfirm={confirm} />}
    </div>
  );
}
