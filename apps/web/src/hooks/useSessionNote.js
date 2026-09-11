// One session's private note, saved as the attendee types (issue #170).
//
// TWO TEXTS, ON PURPOSE. `saved` is what the document carries; `draft` is
// what the reader is typing. The field is a controlled input over the draft
// so typing never fights the listener, and the debounce keeps a keystroke
// from being a write — but only just: the note is saved as the attendee
// types, not on submit, because a browser or a battery has no obligation to
// wait for a submit that may never come.
import { useCallback, useEffect, useRef, useState } from 'react';
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
 *   state: 'loading' | 'editing' | 'saving' | 'saved' | 'error',
 *   maxLength: number,
 *   edit: (next: string) => void,
 *   flush: () => void,
 * }}
 */
export function useSessionNote(uid, sessionId) {
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(Boolean(uid && sessionId));
  const [draft, setDraft] = useState(null); // null = mirror `saved`
  const [state, setState] = useState(loading ? 'loading' : 'saved');
  const timerRef = useRef(null);
  const identityRef = useRef(null);
  const renderedIdentityRef = useRef(null);
  const latestEditRef = useRef(null);
  const writeQueueRef = useRef(Promise.resolve());
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
        if (identityRef.current !== editRecord.identity || !isLatestEdit) return;
        setSaved(editRecord.text);
        setDraft(null); // mirror the document again
        setState('saved');
      },
      () => {
        editRecord.queued = false;
        if (identityRef.current === editRecord.identity && latestEditRef.current === editRecord) {
          setState('error');
        }
      },
    );
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    setSaved('');
    setDraft(null);

    if (!uid || !sessionId) {
      identityRef.current = null;
      setLoading(false);
      setState('saved');
      return undefined;
    }

    const identity = { uid, sessionId };
    identityRef.current = identity;
    setLoading(true);
    setState('loading');
    const unsubscribe = subscribeSessionNote(
      uid,
      sessionId,
      (text) => {
        if (identityRef.current !== identity) return;
        setSaved(text);
        setLoading(false);
        setState((current) => (current === 'loading' ? 'saved' : current));
      },
      () => {
        if (identityRef.current !== identity) return;
        setLoading(false);
        setState('error');
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
        if (isStillRenderedIdentity) {
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
      };
      latestEditRef.current = editRecord;
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

  const flush = useCallback(() => {
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
  };
}
