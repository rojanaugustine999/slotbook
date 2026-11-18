import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { describeError } from "../api/client";
import { useUpdateBusiness } from "../api/hooks";
import type { OwnedBusiness } from "../api/types";
import { slugProblem } from "../lib/slug";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useDashboardBusiness } from "./DashboardLayout";
import { allTimezones, fieldErrorsFrom, type Errors } from "./salonForm";

// ─── The owner's Settings tab ────────────────────────────────────────────────
// Everything about a salon that was fixed once it was created. Three cards, by risk:
//   1. details and booking rules: safe to change any time;
//   2. the booking page address: old shared links stop working, so it's confirmed;
//   3. the timezone: working hours are stored as LOCAL clock times, so changing it changes
//      what those hours mean. Also confirmed.
// ──────────────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const business = useDashboardBusiness();
  // key: start each form again from the saved values whenever they change
  return (
    <div className="space-y-6">
      <Details key={`${business.name}|${business.address}|${business.minNoticeMinutes}|${business.maxAdvanceDays}`} business={business} />
      <BookingAddress key={business.slug} business={business} />
      <Timezone key={business.timezone} business={business} />
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-[15px] font-medium">{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-2">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const selectClass = "h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-[15px] text-ink";

function SavedNote({ show }: { show: boolean }) {
  return show ? <span className="text-sm text-ink-2" role="status">Saved</span> : null;
}

// ─── 1. Details and booking rules ───────────────────────────────────────────

const NOTICE_OPTIONS = [0, 15, 30, 60, 120, 240, 720, 1440, 2880];
const ADVANCE_OPTIONS = [7, 14, 30, 60, 90, 180, 365];

function noticeLabel(minutes: number): string {
  if (minutes === 0) return "None: book right up to the start";
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes < 1440) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
}
const advanceLabel = (days: number) => (days === 7 ? "1 week" : days === 14 ? "2 weeks" : days === 365 ? "1 year" : `${days} days`);
// Keep a value set some other way (through the API) in the list, so the select can show it.
const withCurrent = (options: number[], current: number) => [...new Set([...options, current])].sort((a, b) => a - b);

function Details({ business }: { business: OwnedBusiness }) {
  const save = useUpdateBusiness(business.id);
  const [name, setName] = useState(business.name);
  const [address, setAddress] = useState(business.address ?? "");
  const [notice, setNotice] = useState(business.minNoticeMinutes ?? 60);
  const [advance, setAdvance] = useState(business.maxAdvanceDays ?? 60);
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setErrors({ name: "Enter the salon's name." });
    setErrors({});
    setSaved(false);
    save.mutate(
      { name: name.trim(), address: address.trim(), minNoticeMinutes: notice, maxAdvanceDays: advance },
      { onSuccess: () => setSaved(true), onError: (err) => setErrors(fieldErrorsFrom(err) ?? {}) },
    );
  }

  const changed = () => setSaved(false);
  return (
    <Card title="Salon details and booking rules">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Salon name" value={name} onChange={(e) => { setName(e.target.value); changed(); }} error={errors.name} maxLength={100} />
        <Field label="Street address (optional)" value={address} onChange={(e) => { setAddress(e.target.value); changed(); }} error={errors.address} maxLength={300} hint="Shown on your booking page and in the salon list." />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="min-notice" className="mb-1.5 block text-sm font-medium text-ink-2">Minimum notice</label>
            <select id="min-notice" className={selectClass} value={notice} onChange={(e) => { setNotice(Number(e.target.value)); changed(); }} aria-describedby="min-notice-hint">
              {withCurrent(NOTICE_OPTIONS, notice).map((m) => <option key={m} value={m}>{noticeLabel(m)}</option>)}
            </select>
            <p id="min-notice-hint" className="mt-1.5 text-sm text-ink-3">How soon before an appointment people can still book it.</p>
          </div>
          <div>
            <label htmlFor="max-advance" className="mb-1.5 block text-sm font-medium text-ink-2">Book up to</label>
            <select id="max-advance" className={selectClass} value={advance} onChange={(e) => { setAdvance(Number(e.target.value)); changed(); }} aria-describedby="max-advance-hint">
              {withCurrent(ADVANCE_OPTIONS, advance).map((d) => <option key={d} value={d}>{advanceLabel(d)} ahead</option>)}
            </select>
            <p id="max-advance-hint" className="mt-1.5 text-sm text-ink-3">How far ahead the calendar opens to customers.</p>
          </div>
        </div>
        {save.isError && !Object.keys(errors).length && <Notice tone="error">{describeError(save.error)}</Notice>}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
          <SavedNote show={saved} />
        </div>
      </form>
    </Card>
  );
}

// ─── 2. Booking page address ────────────────────────────────────────────────

function BookingAddress({ business }: { business: OwnedBusiness }) {
  const save = useUpdateBusiness(business.id);
  const [slug, setSlug] = useState(business.slug);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const host = window.location.host;
  const changed = slug !== business.slug;

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = slugProblem(slug);
    if (problem) return setError(problem);
    // Shared links break the moment this changes, so ask once more, in plain words.
    if (!window.confirm(`Change your booking page to ${host}/${slug}?\n\nLinks you've already shared to ${host}/${business.slug} will stop working.`)) return;
    setError(undefined);
    setSaved(false);
    save.mutate({ slug }, { onSuccess: () => setSaved(true), onError: (err) => setError(fieldErrorsFrom(err)?.slug ?? describeError(err)) });
  }

  return (
    <Card title="Booking page address" hint={`Customers book at ${host}/${business.slug}.`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label="New address"
          value={slug}
          // Gentle while typing (lowercase, space becomes a dash), like the create form; the full check runs on save.
          onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-")); setSaved(false); setError(undefined); }}
          error={error}
          maxLength={50}
          autoCapitalize="none"
          spellCheck={false}
          hint={<>Becomes <span className="font-medium text-ink-2">{host}/{slug || "your-salon"}</span></>}
        />
        {changed && (
          <Notice tone="error">
            Links you've already shared (on Instagram, WhatsApp, printed cards) point to /{business.slug} and will stop working.
          </Notice>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!changed} loading={save.isPending}>Change address</Button>
          <SavedNote show={saved} />
        </div>
      </form>
    </Card>
  );
}

// ─── 3. Timezone ────────────────────────────────────────────────────────────

function Timezone({ business }: { business: OwnedBusiness }) {
  const save = useUpdateBusiness(business.id);
  const [timezone, setTimezone] = useState(business.timezone);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const timezones = useMemo(() => allTimezones(business.timezone), [business.timezone]);
  const changed = timezone !== business.timezone;
  const pretty = (zone: string) => zone.replaceAll("_", " ");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm(`Change the timezone to ${pretty(timezone)}?\n\nEveryone's working hours keep their clock times, so "9:00" will mean 9:00 in ${pretty(timezone)}.`)) return;
    setError(undefined);
    setSaved(false);
    save.mutate({ timezone }, { onSuccess: () => setSaved(true), onError: (err) => setError(fieldErrorsFrom(err)?.timezone ?? describeError(err)) });
  }

  return (
    <Card title="Timezone" hint="Opening hours, open times and every date on your pages use this timezone. Usually set once, when the salon is created.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="settings-timezone" className="mb-1.5 block text-sm font-medium text-ink-2">Timezone</label>
          <select id="settings-timezone" className={selectClass} value={timezone} onChange={(e) => { setTimezone(e.target.value); setSaved(false); }}>
            {timezones.map((zone) => <option key={zone} value={zone}>{pretty(zone)}</option>)}
          </select>
          {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
        </div>
        {changed && (
          <Notice tone="error">
            Working hours are saved as clock times, so a staff member working 9:00 to 17:00 will work 9:00 to 17:00 in{" "}
            {pretty(timezone)}: a different real time. Existing bookings keep their real time and are shown in the new timezone.
          </Notice>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!changed} loading={save.isPending}>Change timezone</Button>
          <SavedNote show={saved} />
        </div>
      </form>
    </Card>
  );
}
