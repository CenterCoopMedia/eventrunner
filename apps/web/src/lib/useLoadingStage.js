import { useCallback, useEffect, useRef, useState } from 'react';
import { reportHeldUp } from './fieldVitals.js';

const STAGES = [[1000, 'active'], [10000, 'slow'], [60000, 'prolonged']];
const stageAt = (elapsed) => STAGES.findLast(([at]) => elapsed >= at)?.[1] ?? 'initial';

/**
 * Elapsed waiting time, never estimated progress. Callers own the request and
 * remove the loader (or set active=false) as soon as it finishes.
 */
export default function useLoadingStage({ active = true } = {}) {
  // The HTML fallback is still present during the first React render. That
  // request inherits its navigation clock; later loaders start their own.
  const [boot] = useState(() => Boolean(globalThis.document?.getElementById('app-boot')));
  const [startedAt] = useState(() => boot ? 0 : performance.now());
  const wait = useRef({ active, attempt: 0, startedAt, boot });
  const [stage, setStage] = useState(() => active ? stageAt(performance.now() - startedAt) : 'initial');
  const [attempt, setAttempt] = useState(0);
  const reported = useRef(null);

  useEffect(() => {
    if (wait.current.active !== active || wait.current.attempt !== attempt) {
      wait.current = { active, attempt, startedAt: performance.now(), boot: false };
    }
    if (!active) {
      setStage('initial');
      return undefined;
    }
    const elapsed = performance.now() - wait.current.startedAt;
    setStage(stageAt(elapsed));
    const timers = STAGES.filter(([at]) => at > elapsed)
      .map(([at, next]) => setTimeout(() => setStage(next), Math.ceil(at - elapsed)));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [active, attempt]);

  useEffect(() => {
    if (!active || !['slow', 'prolonged'].includes(stage) || reported.current === wait.current) return;
    reported.current = wait.current;
    reportHeldUp(wait.current.boot);
  }, [active, stage, attempt]);

  const restart = useCallback(() => {
    setStage('initial');
    setAttempt((value) => value + 1);
  }, []);

  return { stage: active ? stage : 'initial', restart };
}
