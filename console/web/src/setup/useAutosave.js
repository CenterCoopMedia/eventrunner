import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { clearKeptAnswer, keepAnswer, readKeptAnswer, removeKeptAnswer } from './keptAnswers.js';

// The masthead waits for the mounted setup's save before signing out.
export const SetupSaveContext = createContext(null);

function keepUnsaved(entries) {
  for (const { scope, value } of entries.values()) keepAnswer(scope, value);
}

/**
 * Save as the client types (ADR 0007 §3). `queue(value)` waits `delay` ms
 * for the typing to stop, then calls `save(value)`. Saves run one at a
 * time, so an older answer never lands after a newer one. A new value
 * replaces a waiting value for the same step. The stepper calls `flush()`
 * to send waiting values before moving to another step. Waiting
 * values are also sent when the page closes.
 *
 * A value whose save fails stays waiting, unless a newer value replaced
 * it, so the next flush sends it again. `flush()` resolves to true when
 * the last save reached the server and false when it failed, so the
 * stepper can stay on the step and the review can hold the request.
 *
 * `status` is 'idle', 'waiting', 'saving', 'saved', 'unsaved' (the server
 * kept the old answer, for example a taken name) or 'error'.
 */
export function useAutosave({ save, onResult, scope, activeStep, delay = 800 }) {
  const [outcome, setOutcome] = useState({ status: 'idle', error: '', failure: null, refused: [] });
  const { error, failure } = outcome;
  const status = outcome.status === 'saved' && outcome.refused.includes(activeStep) ? 'unsaved' : outcome.status;
  const latest = useRef(new Map());
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

  const updateStatus = useCallback(() => {
    const entries = [...latest.current.values()];
    const failed = entries.find((entry) => entry.state === 'error');
    const state = ['error', 'waiting', 'saving']
      .find((state) => entries.some((entry) => entry.state === state));
    setOutcome({
      status: state ?? 'saved',
      error: failed?.error ?? '',
      failure: failed?.failure ?? null,
      refused: entries.filter(({ state }) => state === 'unsaved').map(({ value }) => value.step),
    });
  }, []);

  const flush = useCallback((options = {}) => {
    clearTimeout(timer.current);
    timer.current = null;
    const pending = [...latest.current.values()].filter(({ state }) => state === 'waiting' || state === 'error');
    if (pending.length === 0) return chain.current;
    for (const entry of pending) entry.state = 'saving';
    updateStatus();
    chain.current = chain.current.then(async () => {
      for (const entry of pending) {
        const { value, scope: savedScope } = entry;
        if (latest.current.get(value.step) !== entry) continue;
        try {
          const result = await saveRef.current(value, options);
          onResultRef.current?.(result, value);
          const current = latest.current.get(value.step);
          if (result?.saved === false) {
            entry.state = 'unsaved';
            if (current) keepAnswer(current.scope, current.value);
          } else if (current === entry) {
            clearKeptAnswer(savedScope, value.step);
            latest.current.delete(value.step);
          } else {
            removeKeptAnswer(savedScope, value);
          }
        } catch (err) {
          entry.state = 'error';
          entry.error = err.message;
          entry.failure = { status: err.status ?? 0, code: err.code ?? 'network' };
          const current = latest.current.get(value.step);
          if (current) keepAnswer(current.scope, current.value);
        }
        updateStatus();
      }
      return ![...latest.current.values()].some(({ state }) => state === 'error');
    });
    return chain.current;
  }, [updateStatus]);

  const queue = useCallback((value) => {
    latest.current.set(value.step, { value, scope: scopeRef.current, state: 'waiting' });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
    updateStatus();
  }, [flush, delay, updateStatus]);

  const keepForSignIn = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    for (const { scope: savedScope, value } of latest.current.values()) {
      keepAnswer(savedScope, value);
      if (JSON.stringify(readKeptAnswer(savedScope, value.step)) !== JSON.stringify(value)) return false;
    }
    // Authentication is about to end. Recovery reopens the copy explicitly,
    // without an unmount retry against the signed-out session.
    latest.current.clear();
    return true;
  }, []);

  useEffect(() => {
    const beforeUnload = (event) => {
      keepUnsaved(latest.current);
      event.preventDefault();
      event.returnValue = '';
    };
    const preserve = () => {
      keepUnsaved(latest.current);
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
    beforeSignOut.current = async () => {
      const finished = await flush();
      if (!finished || [...latest.current.values()].some(({ state }) => state !== 'unsaved')) return false;
      // A completed refusal (such as a taken name) must not trap the reader
      // in setup. Explicit sign-out discards their copies after auth exits;
      // stop unmount cleanup from writing the refused answer back then.
      latest.current.clear();
      return true;
    };
    return () => { beforeSignOut.current = null; };
  }, [beforeSignOut, flush]);

  useEffect(() => () => {
    keepUnsaved(latest.current);
    flush();
  }, [flush]);

  return { status, error, failure, queue, flush, keepForSignIn, signingOut: signOut?.signingOut || false };
}

/** The quiet words beside the step, for a screen reader too. */
export function saveStatusText(status, error) {
  if (status === 'waiting' || status === 'saving') return 'Saving.';
  if (status === 'saved') return 'Saved.';
  if (status === 'unsaved') return 'Not saved. Check the answer.';
  if (status === 'error') return `Not saved. ${error}`;
  return '';
}
