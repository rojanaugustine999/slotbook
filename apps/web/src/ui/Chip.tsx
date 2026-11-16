import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

// A pressable option: a staff member, a day, a time. Announces itself to screen
// readers as a toggle (aria-pressed), and shows selection with more than colour alone
// (a thicker border), so it still reads for people who can't tell the colours apart.
export function Chip({ selected, className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "rounded-control border px-3.5 py-2 text-[15px] transition-colors",
        selected ? "border-accent bg-accent-soft font-medium text-accent-ink ring-1 ring-accent" : "border-line-strong bg-surface text-ink hover:bg-sunken",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
