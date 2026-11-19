import { useCallback, useEffect, useState } from 'react';
import { reportHeldUp } from './fieldVitals.js';

const STAGES = [[1000, 'active'], [10000, 'slow'], [60000, 'prolonged']];
const stageAt = (elapsed) => STAGES.findLast(([at]) => elapsed >= at)?.[1] ?? 'initial';

function createClock(inheritNavigation = false) {
  // Only a wait created while the HTML fallback is present shares its start.
  const boot = inheritNavigation && Boolean(globalThis.document?.getElementById('app-boot'));
  return { boot, startedAt: boot ? 0 : performance.now(), reported: false };
}

export function createLoadingAttempt() {
  return { clock: createClock(true), settled: false };
}

function beginWait(active, attempt, inheritNavigation = false) {
  const clock = attempt?.clock ?? createClock(inheritNavigation);
  const stage = active ? stageAt(performance.now() - clock.startedAt) : 'initial';
  return { active, attempt, clock, stage };
}

/**
 * Elapsed waiting time, never estimated progress. Callers own the request and
 * remove the loader (or set active=false) as soon as it finishes.
 */
export default function useLoadingStage({ active = true, routeAttempt = null } = {}) {
  const attempt = routeAttempt?.settled ? null : routeAttempt;
  const [wait, setWait] = useState(() => beginWait(active, attempt, true));
  if (wait.active !== active || wait.attempt !== attempt || (attempt && wait.clock !== attempt.clock)) {
    setWait(beginWait(active, attempt));
  }
  const { clock, stage } = wait;

  useEffect(() => {
    if (!active) return undefined;
    const setStage = (next) => setWait((current) =>
      current.clock === clock && current.stage !== next ? { ...current, stage: next } : current);
    const elapsed = performance.now() - clock.startedAt;
    setStage(stageAt(elapsed));
    const timers = STAGES.filter(([at]) => at > elapsed)
      .map(([at, next]) => setTimeout(() => setStage(next), Math.ceil(at - elapsed)));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [active, clock]);

  useEffect(() => {
    if (!active || !['slow', 'prolonged'].includes(stage) || clock.reported) return;
    clock.reported = true;
    reportHeldUp(clock.boot);
  }, [active, stage, clock]);

  const restart = useCallback(() => {
    if (attempt) attempt.clock = createClock();
    setWait(beginWait(active, attempt));
  }, [active, attempt]);

  return { stage: active ? stage : 'initial', restart };
}
