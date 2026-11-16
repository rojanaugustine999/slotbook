import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover border-transparent",
  secondary: "bg-surface text-ink border-line-strong hover:bg-sunken",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-sunken hover:text-ink",
  danger: "bg-surface text-danger border-line-strong hover:bg-danger-soft",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  block?: boolean;
}

export function Button({ variant = "secondary", loading, block, className, disabled, children, type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-control border px-4 text-[15px] font-medium transition-colors",
        "disabled:opacity-50",
        variants[variant],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
