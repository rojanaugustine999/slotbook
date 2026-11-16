import { formatDuration, formatPrice } from "../lib/money";
import { cn } from "../lib/cn";
import type { PublicService, PublicStaff } from "../api/types";
import { Chip } from "../ui/Chip";

export const ANYONE = "anyone";

export function ServicePicker({ services, selectedId, onSelect }: { services: PublicService[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="grid gap-2" role="group" aria-label="Service">
      {services.map((service) => {
        const selected = service.id === selectedId;
        return (
          <button
            key={service.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(service.id)}
            className={cn(
              "flex items-center justify-between gap-4 rounded-control border px-4 py-3 text-left transition-colors",
              selected ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-line-strong bg-surface hover:bg-sunken",
            )}
          >
            <span>
              <span className={cn("block text-[15px]", selected ? "font-medium text-accent-ink" : "font-medium")}>{service.name}</span>
              <span className="block text-sm text-ink-2">{formatDuration(service.durationMin)}</span>
            </span>
            <span className="text-[15px] font-medium">{formatPrice(service.priceCents)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function StaffPicker({ staff, selectedId, onSelect }: { staff: PublicStaff[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Who would you like">
      <Chip selected={selectedId === ANYONE} onClick={() => onSelect(ANYONE)}>
        Anyone
      </Chip>
      {staff.map((member) => (
        <Chip key={member.id} selected={selectedId === member.id} onClick={() => onSelect(member.id)}>
          {member.name}
        </Chip>
      ))}
    </div>
  );
}
