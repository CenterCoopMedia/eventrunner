import { useEffect, useState } from 'react';
import { reportHeldUp } from './fieldVitals.js';

/** Elapsed milliseconds at which each waiting stage begins. */
export const STAGES = [[1000, 'active'], [10000, 'slow'], [60000, 'prolonged']];
const stageAt = (elapsed) => STAGES.findLast(([at]) => elapsed >= at)?.[1] ?? 'initial';

export function createLoadingClock(inheritNavigation) {
  // Only a wait created while the HTML fallback is present shares its start.
  const boot = Boolean(inheritNavigation && globalThis.document?.getElementById('app-boot'));
  return { boot, startedAt: boot ? 0 : performance.now() };
}

function beginWait(active, shared, phase, inheritNavigation) {
  const clock = shared || createLoadingClock(inheritNavigation);
  const stage = active ? stageAt(performance.now() - clock.startedAt) : 'initial';
  return { active, shared, phase, clock, stage };
}

/**
 * Elapsed waiting time, never estimated progress. Callers own the request and
 * remove the loader (or set active=false) as soon as it finishes.
 * A new phase starts a local clock while the live region stays mounted.
 */
export default function useLoadingStage({ active = true, routeAttempt, phase, report = true } = {}) {
  const shared = !routeAttempt?.settled && routeAttempt?.clock;
  const [wait, setWait] = useState(() => beginWait(active, shared, phase, true));
  if (wait.active !== active || wait.shared !== shared || wait.phase !== phase) {
    setWait(beginWait(active, shared, phase));
  }
  const { clock, stage } = wait;

  useEffect(() => {
    if (!active) return undefined;
    const setStage = (next) => setWait((current) =>
      current.clock === clock && current.stage !== next ? { ...current, stage: next } : current);
    const elapsed = performance.now() - clock.startedAt;
    setStage(stageAt(elapsed));
    const timers = STAGES.filter(([at]) => at > elapsed)
      .map(([at, next]) => setTimeout(setStage, Math.ceil(at - elapsed), next));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [active, clock]);

  useEffect(() => {
    if (!active || !report || !['slow', 'prolonged'].includes(stage) || clock.reported) return;
    clock.reported = true;
    reportHeldUp(clock.boot);
  }, [active, report, stage, clock]);

  function restart() {
    if (shared) routeAttempt.clock = createLoadingClock();
    setWait(beginWait(active, shared && routeAttempt.clock, phase));
  }

  return { stage, clock, restart };
}
