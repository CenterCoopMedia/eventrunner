// One session's private note, saved as the attendee types (issue #170).
//
// TWO TEXTS, ON PURPOSE. `saved` is what the document carries; `draft` is
// what the reader is typing. The field is a controlled input over the draft
// so typing never fights the listener, and the debounce keeps a keystroke
// from being a write — but only just: the note is saved as the attendee
// types, not on submit, because a browser or a battery has no obligation to
// wait for a submit that may never come.
//
// UNSAVED TEXT SURVIVES NAVIGATION (#1007). Each edit also goes to a
// browser-only recovery copy (lib/localDraft.js), cleared only once the
// server confirmed a save of that text, on discard, at sign-out, or after a
// week. A refused save (the ticket grant is updating or does not
// include the session) keeps the copy. The next visit shows a differing
// copy as unsaved text and never saves it on its own: the note may have
// changed since, so only the reader's "Save now" or new typing saves it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { openLocalDraft } from '../lib/localDraft.js';
import {
  SESSION_NOTE_MAX_LENGTH,
  saveSessionNote,
  subscribeSessionNote,
} from '../lib/sessionNotesSource.js';

const SAVE_DEBOUNCE_MS = 800;

/**
 * @param {string | undefined} uid
 * @param {string | undefined} sessionId
 * @returns {{
 *   saved: string,
 *   draft: string,
 *   state: 'loading' | 'editing' | 'saving' | 'saved' | 'error' | 'denied' | 'restored',
 *   maxLength: number,
 *   edit: (next: string) => void,
 *   flush: () => void,
 *   saveNow: () => void,
 *   discard: () => void,
 *   unsaved: boolean,
 * }}
 */
export function useSessionNote(uid, sessionId) {
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(Boolean(uid && sessionId));
  const [draft, setDraft] = useState(null); // null = mirror `saved`
  const [state, setState] = useState(loading ? 'loading' : 'saved');
  // From a refused save until a save succeeds or the reader discards.
  const [unsaved, setUnsaved] = useState(false);
  const timerRef = useRef(null);
  const identityRef = useRef(null);
  const renderedIdentityRef = useRef(null);
  const latestEditRef = useRef(null);
  const listenerErrorRef = useRef(false);
  const writeQueueRef = useRef(Promise.resolve());
  const copyRef = useRef(null); // { identity, store } for the recovery copy
  renderedIdentityRef.current = { uid, sessionId };

  const queueSave = useCallback((editRecord, force = false) => {
    if (!editRecord || editRecord.cancelled) return;
    if (force) editRecord.force = true;
    clearTimeout(editRecord.timer);
    if (timerRef.current === editRecord.timer) timerRef.current = null;
    editRecord.timer = null;
    if (editRecord.queued) return;

    editRecord.queued = true;
    if (identityRef.current === editRecord.identity && latestEditRef.current === editRecord) {
      setState('saving');
    }

    const savePromise = writeQueueRef.current.then(async () => {
      if (editRecord.cancelled || (!editRecord.force && identityRef.current !== editRecord.identity)) {
        return false;
      }
      await saveSessionNote(editRecord.identity.uid, editRecord.identity.sessionId, editRecord.text);
      return true;
    });
    writeQueueRef.current = savePromise.catch(() => {});

    void savePromise.then(
      (didSave) => {
        editRecord.queued = false;
        if (!didSave) return;
        const isLatestEdit = latestEditRef.current === editRecord;
        if (isLatestEdit) latestEditRef.current = null;
        if (!isLatestEdit) return;
        editRecord.copy?.clear();
        if (identityRef.current !== editRecord.identity) return;
        setSaved(editRecord.text);
        setDraft(null); // mirror the document again
        setState('saved');
        setUnsaved(false);
      },
      (err) => {
        editRecord.queued = false;
        if (identityRef.current === editRecord.identity && latestEditRef.current === editRecord) {
          listenerErrorRef.current = false;
          // The rules refuse a note write when the ticket grant is updating
          // or does not include this session (#557). The draft stays.
          setState(err?.code === 'permission-denied' ? 'denied' : 'error');
          setUnsaved(true);
        }
      },
    );
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    listenerErrorRef.current = false;
    copyRef.current = null;
    setSaved('');
    setDraft(null);
    setUnsaved(false);

    if (!uid || !sessionId) {
      identityRef.current = null;
      setLoading(false);
      setState('saved');
      return undefined;
    }

    const identity = { uid, sessionId };
    identityRef.current = identity;
    const store = openLocalDraft(uid, `users/${uid}/sessionNotes/${sessionId}`, 'note');
    copyRef.current = { identity, store };
    let restoreChecked = false;
    setLoading(true);
    setState('loading');
    const unsubscribe = subscribeSessionNote(
      uid,
      sessionId,
      (text) => {
        if (identityRef.current !== identity) return;
        const recoveredListenerError = listenerErrorRef.current;
        listenerErrorRef.current = false;
        setSaved(text);
        setLoading(false);
        if (!restoreChecked) {
          restoreChecked = true;
          // An edit typed before this first answer is newer than any copy.
          const typing = latestEditRef.current?.identity === identity;
          const copy = typing ? null : store.read();
          // A copy that matches the note shows nothing and stays: only a
          // confirmed save, discard or sign-out removes it.
          if (copy && copy.value !== text) {
            latestEditRef.current = {
              identity, text: copy.value, timer: null, queued: false, force: false, cancelled: false,
              copy: store, restored: true,
            };
            setDraft(copy.value);
            setState('restored');
            setUnsaved(true);
            return;
          }
        }
        setState((current) => {
          if (current === 'loading') return 'saved';
          if (recoveredListenerError && current === 'error' && !latestEditRef.current) {
            return 'saved';
          }
          return current;
        });
      },
      () => {
        if (identityRef.current !== identity) return;
        listenerErrorRef.current = true;
        setLoading(false);
        if (latestEditRef.current?.identity !== identity) setState('error');
      },
    );
    return () => {
      const renderedIdentity = renderedIdentityRef.current;
      const isStillRenderedIdentity = renderedIdentity.uid === uid &&
        renderedIdentity.sessionId === sessionId;
      const latestEdit = latestEditRef.current;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (identityRef.current === identity) identityRef.current = null;
      if (latestEdit?.identity === identity) {
        latestEdit.timer = null;
        if (isStillRenderedIdentity && !latestEdit.restored) {
          queueSave(latestEdit, true);
        } else {
          if (!latestEdit.force) latestEdit.cancelled = true;
          latestEditRef.current = null;
        }
      }
      unsubscribe();
    };
  }, [queueSave, uid, sessionId]);

  const edit = useCallback(
    (next) => {
      const identity = identityRef.current;
      if (!identity || identity.uid !== uid || identity.sessionId !== sessionId) return;

      const bounded = next.slice(0, SESSION_NOTE_MAX_LENGTH);
      const previousEdit = latestEditRef.current;
      if (previousEdit && previousEdit.timer !== null) {
        clearTimeout(previousEdit.timer);
        previousEdit.timer = null;
        previousEdit.cancelled = true;
      }
      const editRecord = {
        identity,
        text: bounded,
        timer: null,
        queued: false,
        force: false,
        cancelled: false,
        copy: copyRef.current?.identity === identity ? copyRef.current.store : null,
      };
      latestEditRef.current = editRecord;
      if (editRecord.copy) editRecord.copy.write(bounded, '');
      setDraft(bounded);
      setState('editing');
      clearTimeout(timerRef.current);
      editRecord.timer = setTimeout(() => {
        timerRef.current = null;
        editRecord.timer = null;
        queueSave(editRecord);
      }, SAVE_DEBOUNCE_MS);
      timerRef.current = editRecord.timer;
    },
    [queueSave, uid, sessionId],
  );

  /** Drop the unsaved text and its recovery copy; the field shows the saved note. */
  const discard = useCallback(() => {
    const latestEdit = latestEditRef.current;
    if (!latestEdit || latestEdit.identity !== identityRef.current) return;
    clearTimeout(latestEdit.timer);
    latestEdit.timer = null;
    latestEdit.cancelled = true;
    latestEditRef.current = null;
    latestEdit.copy?.clear();
    setDraft(null);
    setState('saved');
    setUnsaved(false);
  }, []);

  // Leaving the field saves typed text; restored text waits for saveNow.
  const flush = useCallback(() => {
    const latestEdit = latestEditRef.current;
    if (latestEdit?.identity === identityRef.current && !latestEdit.restored) queueSave(latestEdit, true);
  }, [queueSave]);

  const saveNow = useCallback(() => {
    const latestEdit = latestEditRef.current;
    if (latestEdit?.identity === identityRef.current) queueSave(latestEdit, true);
  }, [queueSave]);

  return {
    saved,
    draft: draft ?? saved,
    state: loading ? 'loading' : state,
    maxLength: SESSION_NOTE_MAX_LENGTH,
    edit,
    flush,
    saveNow,
    discard,
    unsaved,
  };
}
