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
 * }}
 */
export function useSessionNote(uid, sessionId) {
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(Boolean(uid && sessionId));
  const [draft, setDraft] = useState(null); // null = mirror `saved`
  const [state, setState] = useState(loading ? 'loading' : 'saved');
  const timerRef = useRef(null);

  useEffect(() => {
    if (!uid || !sessionId) {
      setLoading(false);
      setState('saved');
      return undefined;
    }
    setLoading(true);
    const unsubscribe = subscribeSessionNote(
      uid,
      sessionId,
      (text) => {
        setSaved(text);
        setLoading(false);
        setState((current) => (current === 'saving' ? current : 'saved'));
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [uid, sessionId]);

  // The pending save is cancelled on unmount and on identity change: the
  // debounce exists to batch keystrokes, never to hold them hostage.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const edit = useCallback(
    (next) => {
      const bounded = next.slice(0, SESSION_NOTE_MAX_LENGTH);
      setDraft(bounded);
      setState('editing');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        setState('saving');
        try {
          await saveSessionNote(uid, sessionId, bounded);
          setSaved(bounded);
          setDraft(null); // mirror the document again
          setState('saved');
        } catch {
          setState('error');
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [uid, sessionId],
  );

  return {
    saved,
    draft: draft ?? saved,
    state: loading ? 'loading' : state,
    maxLength: SESSION_NOTE_MAX_LENGTH,
    edit,
  };
}
