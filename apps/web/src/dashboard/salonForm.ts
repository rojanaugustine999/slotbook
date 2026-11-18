import { ApiError } from "../api/client";

// Shared by "Set up your salon" (CreateBusiness.tsx) and the Settings tab (SettingsPage.tsx),
// so both list the same timezones and show the API's errors the same way.

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

export function browserTimezone(): string {
  return currentName(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
}

export function allTimezones(selected: string): string[] {
  // Older browsers lack supportedValuesOf; then the list is just the guess.
  const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone").map(currentName) : [];
  return [...new Set([selected, ...list])].sort();
}

// The salon fields a form can show an error under (create form and Settings tab).
export type Fields = "name" | "slug" | "timezone" | "address" | "minNoticeMinutes" | "maxAdvanceDays";
export type Errors = Partial<Record<Fields, string>>;

// The API sends field problems as { slug: ["..."], ... }. Turn its wording into a sentence.
export function fieldErrorsFrom(error: unknown): Errors | null {
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
