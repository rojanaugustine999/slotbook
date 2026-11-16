// Joins class names, skipping anything falsy, so conditions stay readable:
//   cn("rounded", selected && "bg-accent", disabled && "opacity-50")
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
