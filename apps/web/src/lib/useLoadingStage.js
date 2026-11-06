import { useCallback, useEffect, useState } from 'react';

/**
 * Elapsed waiting time, never estimated progress. Callers own the request and
 * remove the loader (or set active=false) as soon as it finishes.
 */
export default function useLoadingStage({ active = true } = {}) {
  const [stage, setStage] = useState('initial');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setStage('initial');
    if (!active) return undefined;

    const timers = [
      setTimeout(() => setStage('active'), 1000),
      setTimeout(() => setStage('slow'), 10000),
      setTimeout(() => setStage('prolonged'), 60000),
    ];
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [active, attempt]);

  const restart = useCallback(() => {
    setStage('initial');
    setAttempt((value) => value + 1);
  }, []);

  return { stage: active ? stage : 'initial', restart };
}
