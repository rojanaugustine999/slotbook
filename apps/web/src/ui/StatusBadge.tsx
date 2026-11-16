import { cn } from "../lib/cn";
import type { BookingStatus } from "../api/types";

const styles: Record<BookingStatus, { label: string; classes: string }> = {
  pending: { label: "Pending", classes: "bg-warn-soft text-warn" },
  confirmed: { label: "Confirmed", classes: "bg-accent-soft text-accent-ink" },
  completed: { label: "Completed", classes: "bg-success-soft text-success" },
  cancelled: { label: "Cancelled", classes: "bg-sunken text-ink-3" },
  no_show: { label: "No-show", classes: "bg-danger-soft text-danger" },
};

// The status is always written out as text, never colour alone.
export function StatusBadge({ status }: { status: BookingStatus }) {
  const { label, classes } = styles[status];
  return <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium", classes)}>{label}</span>;
}
