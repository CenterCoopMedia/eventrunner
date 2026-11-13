import { useEffect, useRef, useState } from 'react';
import { openLocalDraft } from '../lib/localDraft.js';

export function useLocalDraft({ accountId, docPath, version, value, dirty, enabled }) {
  const sessionRef = useRef(null);
  const [recovery, setRecovery] = useState(null);
  const [kept, setKept] = useState(false);

  useEffect(() => {
    if (!enabled || !accountId) return undefined;
    const store = openLocalDraft(accountId, docPath, version);
    const copy = store.read();
    const session = { store, value, dirty, copy: copy?.value === value ? null : copy, timer: null };
    sessionRef.current = session;
    setRecovery(session.copy);
    setKept(false);
    const flush = () => {
      clearTimeout(session.timer);
      if (session.dirty && !session.copy) setKept(store.write(session.value));
    };
    session.flush = flush;
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    const cleared = (event) => {
      if (!store.isSignOutEvent(event) || !store.revoked()) return;
      clearTimeout(session.timer);
      session.dirty = false;
      session.copy = null;
      setRecovery(null);
      setKept(false);
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('storage', cleared);
    window.addEventListener('admin-drafts-cleared', cleared);
    return () => {
      flush(); // A lost sign-in unmounts the editor without a leave dialog.
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('storage', cleared);
      window.removeEventListener('admin-drafts-cleared', cleared);
      sessionRef.current = null;
    };
    // Version belongs to the revision first loaded, not later listener echoes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, docPath, enabled]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    clearTimeout(session.timer);
    session.value = value;
    session.dirty = dirty;
    if (dirty && !session.copy) session.timer = setTimeout(session.flush, 500);
    else if (!dirty && !session.copy) {
      session.store.clear();
      setKept(false);
    }
  }, [value, dirty, enabled, accountId, docPath]);

  function discard() {
    const session = sessionRef.current;
    if (!session) return;
    clearTimeout(session.timer);
    session.store.clear();
    session.copy = null;
    session.dirty = false;
    setRecovery(null);
    setKept(false);
  }

  function restore() {
    const session = sessionRef.current;
    if (!session?.copy || session.store.revoked()) return null;
    const copy = session.copy;
    session.store.restore(copy);
    session.copy = null;
    setRecovery(null);
    return copy.value;
  }

  function saved(submitted, beforeAssignment = submitted) {
    const session = sessionRef.current;
    if (!session) return;
    if (session.value === submitted || session.value === beforeAssignment) discard();
    else session.flush(); // Keep text typed while the request was in flight.
  }

  return { recovery, kept, restore, discard, saved, flush: () => sessionRef.current?.flush() };
}
