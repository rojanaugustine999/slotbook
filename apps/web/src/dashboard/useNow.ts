import { DateTime } from "luxon";
import { useEffect, useState } from "react";

// The current time, refreshed every minute, so the "now" line on the calendar moves
// and "has this booking started yet?" stays right while the page is left open.
export function useNow(intervalMs = 60_000): DateTime {
  const [now, setNow] = useState(() => DateTime.now());
  useEffect(() => {
    const id = setInterval(() => setNow(DateTime.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
