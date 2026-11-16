// ─── Salon name → web address ────────────────────────────────────────────────
// "Glow Salon & Spa" → "glow-salon-spa". The API's rule is: lowercase letters, numbers
// and single dashes, 3 to 50 characters. This only suggests an address as the owner
// types; the API still checks it (and whether it is free or reserved) on save.
// ──────────────────────────────────────────────────────────────────────────────
export const SLUG_MAX = 50;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD") // "é" becomes "e" + an accent mark...
      .replace(/[̀-ͯ]/g, "") // ...and the accent mark is dropped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-") // anything else (spaces, &, ') becomes one dash
      .slice(0, SLUG_MAX)
      .replace(/^-+|-+$/g, "") // no dash at either end, even after cutting to length
  );
}

/** Why a typed address won't work, or null if it looks fine. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters.";
  if (slug.length > SLUG_MAX) return `Use at most ${SLUG_MAX} characters.`;
  if (!SLUG_PATTERN.test(slug)) return "Use lowercase letters, numbers and single dashes, like glow-salon.";
  return null;
}
