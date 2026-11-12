import { useEffect, useState } from 'react';

export const SECOND_MS = 1000;

/** Real seconds since the work started: one interval, no animation, nothing invented between ticks. */
export function useElapsed(startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === undefined) return undefined;
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / SECOND_MS));
}
