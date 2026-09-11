// The event wall clock, refreshed on a timer (issue #167).
//
// A session runs for an hour; a page left open across that hour has to move
// the mark on its own, because the reader will not reload it to hear that
// the session has ended. The refresh is one tick a minute — a minute is
// finer than any wall-clock time the page renders, and it costs nothing.
// There is no animation anywhere near this: the tick re-renders text, so
// `prefers-reduced-motion` has nothing to shorten.
import { useEffect, useState } from 'react';

const REFRESH_MS = 60_000;

/**
 * @param {{ intervalMs?: number }} [options] injectable for tests
 * @returns {Date}
 */
export function useEventClock({ intervalMs = REFRESH_MS } = {}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!(intervalMs > 0)) return undefined;
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
