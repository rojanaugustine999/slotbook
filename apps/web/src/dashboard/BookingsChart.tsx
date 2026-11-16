import { DateTime } from "luxon";
import { cn } from "../lib/cn";
import { labelStride, niceMax } from "./chart";

interface Props {
  data: { date: string; count: number }[];
  today: string;
}

const short = (date: string) => DateTime.fromISO(date).toFormat("d LLL");
const long = (date: string) => DateTime.fromISO(date).toFormat("ccc d LLL");

// A bar chart of bookings per day, drawn with plain elements (no chart library): one column
// per day, bars sized as a percentage of the axis. Hover a bar for the exact figure. Screen
// readers can't see bars, so the chart is announced as a short summary, and the same numbers
// are available as a table that is hidden from sight.
export function BookingsChart({ data, today }: Props) {
  const peak = Math.max(0, ...data.map((d) => d.count));
  const top = niceMax(peak);
  const stride = labelStride(data.length);
  const showValues = data.length <= 14; // with more bars the numbers would run into each other
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const ticks = [top, top / 2, 0]; // the three gridlines, top to bottom

  return (
    <figure>
      <div className="flex gap-2">
        {/* The numbers down the left side */}
        <div className="relative mt-6 h-44 w-6 shrink-0 text-[11px] text-ink-3" aria-hidden="true">
          {ticks.map((tick, i) => (
            <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / 2) * 100}%` }}>
              {Number.isInteger(tick) ? tick : ""}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div role="img" aria-label={`Bar chart of bookings per day: ${total} in total over ${data.length} days, at most ${peak} in one day.`} className="relative mt-6 h-44">
            {ticks.map((_, i) => (
              <div key={i} className="absolute inset-x-0 border-t border-line" style={{ top: `${(i / 2) * 100}%` }} />
            ))}

            <div className="absolute inset-0 flex gap-[2px]">
              {data.map((day) => {
                const percent = (day.count / top) * 100;
                const empty = day.count === 0;
                return (
                  <div key={day.date} className="relative min-w-0 flex-1" title={`${long(day.date)}: ${day.count} ${day.count === 1 ? "booking" : "bookings"}`}>
                    <div
                      className={cn("absolute inset-x-0 bottom-0", empty ? "h-[2px] bg-line-strong" : cn("rounded-t-[3px]", day.date === today ? "bg-accent-hover" : "bg-accent"))}
                      style={empty ? undefined : { height: `${percent}%` }}
                    />
                    {showValues && !empty && (
                      <span className="absolute inset-x-0 text-center text-[11px] text-ink-2" style={{ bottom: `calc(${percent}% + 3px)` }}>
                        {day.count}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* The dates along the bottom: every n-th, so they never crowd */}
          <div className="mt-1.5 flex gap-[2px]" aria-hidden="true">
            {data.map((day, i) => (
              <div key={day.date} className="relative h-4 min-w-0 flex-1">
                {i % stride === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-ink-3">{short(day.date)}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The hiding must be on a wrapper <div>, not on the <table> itself: browsers don't clip a
          table's rows, so a hidden table would still take up its full height and stretch the page. */}
      <div className="sr-only">
        <table>
          <caption>Bookings per day</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Bookings</th>
            </tr>
          </thead>
          <tbody>
            {data.map((day) => (
              <tr key={day.date}>
                <td>{long(day.date)}</td>
                <td>{day.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
