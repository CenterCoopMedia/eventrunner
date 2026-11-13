import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { keepAnswer, removeKeptAnswer } from './keptAnswers.js';

// The masthead waits for the mounted setup's save before signing out.
export const SetupSaveContext = createContext(null);

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
 * stepper can stay on the step and the review can hold the request.
 *
 * `status` is 'idle', 'waiting', 'saving', 'saved', 'unsaved' (the server
 * kept the old answer, for example a taken name) or 'error'.
 */
export function useAutosave({ save, onResult, scope, delay = 800 }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const pending = useRef(undefined);
  const latest = useRef(undefined);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const signOut = useContext(SetupSaveContext);
  const timer = useRef(null);
  const chain = useRef(Promise.resolve(true));
  const saveRef = useRef(save);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    saveRef.current = save;
    onResultRef.current = onResult;
  });

  const flush = useCallback((options = {}) => {
    clearTimeout(timer.current);
    timer.current = null;
    if (pending.current === undefined) return chain.current;
    const entry = pending.current;
    const { value, scope: savedScope } = entry;
    pending.current = undefined;
    setStatus('saving');
    chain.current = chain.current.then(async () => {
      try {
        const result = await saveRef.current(value, options);
        setError('');
        if (result?.saved === false) keepAnswer(savedScope, value);
        else {
          removeKeptAnswer(savedScope, value);
          if (latest.current === entry) latest.current = undefined;
        }
        // A newer value queued during this save is still waiting: say so,
        // not 'saved', until its own save lands.
        if (pending.current !== undefined) setStatus('waiting');
        else setStatus(result && result.saved === false ? 'unsaved' : 'saved');
        onResultRef.current?.(result, value);
        return true;
      } catch (err) {
        const kept = latest.current || entry;
        keepAnswer(kept.scope, kept.value);
        if (latest.current === entry && pending.current === undefined) pending.current = entry;
        setError(err.message);
        setStatus('error');
        return false;
      }
    });
    return chain.current;
  }, []);

  const queue = useCallback((value) => {
    pending.current = { value, scope: scopeRef.current };
    latest.current = pending.current;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
    setStatus('waiting');
  }, [flush, delay]);

  useEffect(() => {
    const beforeUnload = (event) => {
      if (latest.current) keepAnswer(latest.current.scope, latest.current.value);
      event.preventDefault();
      event.returnValue = '';
    };
    const preserve = () => {
      if (latest.current) keepAnswer(latest.current.scope, latest.current.value);
      // Save and token lookup may outlive this page; the copy comes first.
      flush({ keepalive: true });
    };
    const visibility = () => { if (document.visibilityState === 'hidden') preserve(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', preserve);
    const dirty = status === 'waiting' || status === 'saving' || status === 'error' || status === 'unsaved';
    if (dirty) window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', preserve);
      if (dirty) window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [flush, status]);

  const beforeSignOut = signOut?.flush;
  useEffect(() => {
    if (!beforeSignOut) return;
    beforeSignOut.current = async () => (await flush()) && latest.current === undefined;
    return () => { beforeSignOut.current = null; };
  }, [beforeSignOut, flush]);

  useEffect(() => () => {
    if (latest.current) keepAnswer(latest.current.scope, latest.current.value);
    flush();
  }, [flush]);

  return { status, error, queue, flush, signingOut: signOut?.signingOut || false };
}

/** The quiet words beside the step, for a screen reader too. */
export function saveStatusText(status, error) {
  if (status === 'waiting' || status === 'saving') return 'Saving.';
  if (status === 'saved') return 'Saved.';
  if (status === 'unsaved') return 'Not saved. Check the answer.';
  if (status === 'error') return `Not saved. ${error}`;
  return '';
}
