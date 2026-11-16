import { useEffect, useState } from "react";

// On a free hosting plan the API goes to sleep when nobody has visited for a while,
// and the first request then takes up to a minute. A spinner alone for that long looks
// broken, so after a few seconds we say what is happening.
export function WakingUp({ afterMs = 4000 }: { afterMs?: number }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), afterMs);
    return () => clearTimeout(timer);
  }, [afterMs]);

  if (!show) return null;
  return (
    <p role="status" className="mt-4 max-w-xs text-center text-sm text-ink-3">
      Waking up the server. It sleeps when nobody has visited for a while, so this first load can take up to a minute.
    </p>
  );
}
