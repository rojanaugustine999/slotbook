import { useId, type InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

// A label tied to its input (so tapping the label focuses the field and screen readers
// announce it), with the error message announced too.
export function Field({ label, error, className, ...rest }: Props) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          "h-11 w-full rounded-control border bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-3",
          error ? "border-danger" : "border-line-strong",
          className,
        )}
        {...rest}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
