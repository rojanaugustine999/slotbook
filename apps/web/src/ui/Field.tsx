import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  /** A short help line under the field. Hidden while there is an error, which says more. */
  hint?: ReactNode;
}

// A label tied to its input (so tapping the label focuses the field and screen readers
// announce it), with the error message announced too.
export function Field({ label, error, hint, className, ...rest }: Props) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-11 w-full rounded-control border bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-3",
          error ? "border-danger" : "border-line-strong",
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-3">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
