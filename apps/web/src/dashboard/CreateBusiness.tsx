import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ApiError, describeError } from "../api/client";
import { useCreateBusiness } from "../api/hooks";
import { slugify, slugProblem } from "../lib/slug";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";

// ─── Timezones ───────────────────────────────────────────────────────────────
// Working hours are stored as "minutes after midnight in the salon's timezone", so the
// timezone decides what "9:00" means. We guess it from the owner's browser, which is
// right for almost everyone, and let them change it.
// Some browsers still use old names for a few zones (Chrome says "Asia/Calcutta").
// They work, but owners expect the current name, so we swap the common ones.
// ──────────────────────────────────────────────────────────────────────────────
const RENAMED_ZONES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
};
const currentName = (zone: string) => RENAMED_ZONES[zone] ?? zone;

function browserTimezone(): string {
  return currentName(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
}

function allTimezones(selected: string): string[] {
  // Older browsers lack supportedValuesOf; then the list is just the guess.
  const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone").map(currentName) : [];
  return [...new Set([selected, ...list])].sort();
}

type Fields = "name" | "slug" | "timezone" | "address";
type Errors = Partial<Record<Fields, string>>;

// The API sends field problems as { slug: ["..."], ... }. Turn its wording into a sentence.
function fieldErrorsFrom(error: unknown): Errors | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "SLUG_TAKEN") return { slug: error.message };
  if (error.code === "VALIDATION_ERROR" && error.details) {
    const errors: Errors = {};
    for (const [field, messages] of Object.entries(error.details)) {
      const first = messages[0];
      if (first) errors[field as Fields] = first.charAt(0).toUpperCase() + first.slice(1);
    }
    return errors;
  }
  return null;
}

/** "Set up your salon": shown in the dashboard to a signed-in person who doesn't own one yet. */
export function CreateBusiness() {
  const navigate = useNavigate();
  const createBusiness = useCreateBusiness();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false); // once they type an address themselves, stop overwriting it
  const [timezone, setTimezone] = useState(browserTimezone);
  const [address, setAddress] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const timezones = useMemo(() => allTimezones(timezone), [timezone]);
  const host = window.location.host;

  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
    setErrors((e) => ({ ...e, name: undefined, ...(slugEdited ? {} : { slug: undefined }) }));
  }

  function changeSlug(value: string) {
    setSlugEdited(true);
    // Help as they type: lowercase, and a space becomes a dash.
    setSlug(value.toLowerCase().replace(/\s+/g, "-"));
    setErrors((e) => ({ ...e, slug: undefined }));
  }

  // Check what we can here, so most mistakes show up without a trip to the server.
  // The server checks everything again: anyone can send requests without this form.
  function checkLocally(): Errors {
    const found: Errors = {};
    if (name.trim().length < 2) found.name = "Enter your salon's name.";
    const problem = slugProblem(slug);
    if (problem) found.slug = problem;
    return found;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const found = checkLocally();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    createBusiness.mutate(
      { name: name.trim(), slug, timezone, address: address.trim() || undefined },
      {
        // A new salon has nothing to book yet, so setup starts with what it offers.
        onSuccess: (business) => navigate(`/dashboard/${business.id}/services`, { replace: true }),
        onError: (error) => {
          const fieldErrors = fieldErrorsFrom(error);
          if (fieldErrors && Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
          else setFormError(describeError(error));
        },
      },
    );
  }

  return (
    <div className="mx-auto max-w-lg py-6 sm:py-10">
      <h1 className="text-2xl font-medium">Set up your salon</h1>
      <p className="mt-2 text-ink-2">Start with the basics. You'll add services, staff and opening hours next.</p>

      <form onSubmit={submit} noValidate className="mt-8 space-y-5 rounded-card border border-line bg-surface p-5 sm:p-6">
        <Field label="Salon name" value={name} onChange={(e) => changeName(e.target.value)} error={errors.name} autoComplete="organization" maxLength={100} placeholder="Glow Salon" required />

        <Field
          label="Booking page address"
          value={slug}
          onChange={(e) => changeSlug(e.target.value)}
          error={errors.slug}
          maxLength={50}
          placeholder="glow-salon"
          autoCapitalize="none"
          spellCheck={false}
          required
          hint={
            <>
              Customers book at{" "}
              <span className="font-medium text-ink-2">
                {host}/{slug || "your-salon"}
              </span>
            </>
          }
        />

        <div>
          <label htmlFor="timezone" className="mb-1.5 block text-sm font-medium text-ink-2">
            Timezone
          </label>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-describedby="timezone-hint"
            className="h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-[15px] text-ink"
          >
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <p id="timezone-hint" className={`mt-1.5 text-sm ${errors.timezone ? "text-danger" : "text-ink-3"}`}>
            {errors.timezone ?? "Opening hours and booking times use this timezone."}
          </p>
        </div>

        <Field label="Street address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} error={errors.address} autoComplete="street-address" maxLength={300} placeholder="MG Road, Kochi" />

        {formError && <Notice tone="error">{formError}</Notice>}

        <Button type="submit" variant="primary" block loading={createBusiness.isPending}>
          Create salon
        </Button>
      </form>
    </div>
  );
}
