import { useEffect, useState } from 'react';
import { readClosesAt } from 'shared/pitch';
import { subscribePitchCall } from './pitchSource.js';
import { IS_DEMO } from './demoMode.js';

// setTimeout stores its delay in 32 bits; a longer wait fires at once.
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * True while the live call for sessions accepts pitches. A read error, a
 * missing document, or a passed deadline reads as closed, the same rule the
 * /pitch page and the server use.
 */
export function usePitchCallOpen() {
  const [settings, setSettings] = useState(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (IS_DEMO) return undefined;
    return subscribePitchCall(setSettings, () => setSettings(null));
  }, []);
  const deadline = Date.parse(readClosesAt(settings?.closesAt));
  const open = settings?.enabled === true && Number.isFinite(deadline) && deadline > now;
  useEffect(() => {
    if (!open) return undefined;
    // Re-check once at the deadline so the action leaves without a reload.
    const timer = setTimeout(() => setNow(Date.now()), Math.min(deadline - Date.now() + 1, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [open, deadline, now]);
  return open;
}
