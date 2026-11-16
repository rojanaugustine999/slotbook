import { twMerge } from "tailwind-merge";

// Joins class names, skipping anything falsy, so conditions stay readable:
//   cn("rounded", selected && "bg-accent", disabled && "opacity-50")
//
// twMerge also settles CONFLICTS: when two classes set the same thing (px-4 and px-0),
// the last one wins. Without it, which one applies depends on the order Tailwind happens
// to write them in its stylesheet, so a component's own "px-4" could silently beat the
// "px-0" a caller passed in to override it.
export function cn(...parts: (string | false | null | undefined)[]): string {
  return twMerge(parts.filter(Boolean).join(" "));
}
