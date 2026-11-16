import type { ReactNode } from "react";
import { cn } from "../lib/cn";

type Tone = "error" | "info" | "success";

const tones: Record<Tone, string> = {
  error: "bg-danger-soft text-danger border-danger/30",
  info: "bg-sunken text-ink-2 border-line",
  success: "bg-success-soft text-success border-success/30",
};

// role="alert" makes screen readers announce errors the moment they appear.
export function Notice({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-control border px-3.5 py-2.5 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}
