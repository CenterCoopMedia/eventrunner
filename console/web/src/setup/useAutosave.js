import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Save as the client types (ADR 0007 §3). `queue(value)` waits `delay` ms
 * for the typing to stop, then calls `save(value)`. Saves run one at a
 * time, so an older answer never lands after a newer one, and only the
 * latest queued value is sent. `flush()` sends a waiting value now; the
 * stepper calls it before it moves to another step. A waiting value is
 * also sent when the page closes the step.
 *
 * A value whose save fails stays waiting, unless a newer value replaced
 * it, so the next flush sends it again. `flush()` resolves to true when
 * the last save reached the server and false when it failed, so the
 * stepper can stay on the step and the review can hold the request. When
 * the server kept the old answer (saved: false), it resolves to 'refused',
 * so Next can stay on the step while Back still works.
 *
 * `status` is 'idle', 'waiting', 'saving', 'saved', 'unsaved' (the server
 * kept the old answer, for example a taken name) or 'error'.
 */
export function useAutosave({ save, onResult, delay = 800 }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const pending = useRef(undefined);
  const timer = useRef(null);
  const chain = useRef(Promise.resolve(true));
  const saveRef = useRef(save);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    saveRef.current = save;
    onResultRef.current = onResult;
  });

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    if (pending.current === undefined) return chain.current;
    const value = pending.current;
    pending.current = undefined;
    setStatus('saving');
    chain.current = chain.current.then(async () => {
      try {
        const result = await saveRef.current(value);
        setError('');
        setStatus(result && result.saved === false ? 'unsaved' : 'saved');
        onResultRef.current?.(result, value);
        return result && result.saved === false ? 'refused' : true;
      } catch (err) {
        if (pending.current === undefined) pending.current = value;
        setError(err.message);
        setStatus('error');
        return false;
      }
    });
    return chain.current;
  }, []);

  const queue = useCallback((value) => {
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
    setStatus('waiting');
  }, [flush, delay]);

  useEffect(() => () => {
    flush();
  }, [flush]);

  return { status, error, queue, flush };
}

/** The quiet words beside the step, for a screen reader too. */
export function saveStatusText(status, error) {
  if (status === 'waiting' || status === 'saving') return 'Saving.';
  if (status === 'saved') return 'Saved.';
  if (status === 'unsaved') return 'Not saved. Check the answer.';
  if (status === 'error') return `Not saved. ${error}`;
  return '';
}
