// Each staff member gets a colour on the calendar. The colours are design tokens
// (--staff-a, -b, -c in index.css), and the class names are written out in full here
// because Tailwind only creates the classes it can see spelled out in the source.
const STYLES = [
  { block: "border-staff-a bg-staff-a-soft", dot: "bg-staff-a" },
  { block: "border-staff-b bg-staff-b-soft", dot: "bg-staff-b" },
  { block: "border-staff-c bg-staff-c-soft", dot: "bg-staff-c" },
] as const;

export function staffStyle(index: number) {
  return STYLES[((index % STYLES.length) + STYLES.length) % STYLES.length]!;
}
