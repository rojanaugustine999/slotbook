import { useEffect, useState } from "react";

/**
 * The value, but only after it has stopped changing for `delayMs`.
 * For a search box: typing "kochi" asks the server once, after the pause, not five times.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer); // a new keystroke cancels the previous wait
  }, [value, delayMs]);

  return debounced;
}
