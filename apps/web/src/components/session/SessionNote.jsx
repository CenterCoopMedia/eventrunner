// SessionNote — the attendee's private note on one session (issue #170).
//
// PRIVATE BY DEFAULT AND BY WORDS. The label says "Private note" because
// that is the fact the reader needs: this text lives in their own account
// subtree, nobody else can read it, and it shows nowhere but their own
// schedule. It is a plain textarea — the keyboard path is the platform's,
// and saving happens while they type, with the answer stated under the
// field rather than assumed.
//
// THE LOADED TEXT ARRIVES ASYNCHRONOUSLY, and the field must not clobber
// what the reader has already typed when it does: the hook mirrors the
// document until the reader edits, so a slow snapshot can never overwrite
// a keystroke.
import { useRef } from 'react';
import { useSessionNote } from '../../hooks/useSessionNote.js';
import { inputClass, quietActionClass } from '../controlClasses.js';

const STATE_TEXT = {
  editing: '',
  saving: 'Saving…',
  saved: 'Saved.',
  error: 'The note could not be saved. Try again.',
  denied: 'Access updating, or your ticket does not include this session. Your note is still here. Try again later.',
};

/**
 * @param {{ uid: string, sessionId: string, noteId?: string }} props
 */
export default function SessionNote({ uid, sessionId, noteId }) {
  const { draft, state, maxLength, edit, flush, discard, unsaved } = useSessionNote(uid, sessionId);
  const labelId = `note-${noteId ?? sessionId}`;
  const discardRef = useRef(null);
  // Moving to Discard must not save the text first.
  const onBlur = (event) => {
    if (!discardRef.current || event.relatedTarget !== discardRef.current) flush();
  };

  return (
    <div className="mt-sm">
      {/* The visible label rides above its own control — the eyebrow ban's
          one named exception (design brief §2.4). */}
      <label htmlFor={labelId} className="block font-data text-caption font-semibold text-text-primary">
        Private note
      </label>
      <textarea
        id={labelId}
        rows={2}
        className={`mt-3xs ${inputClass}`}
        value={draft}
        maxLength={maxLength}
        placeholder="Only you can see this."
        onChange={(event) => edit(event.target.value)}
        onBlur={onBlur}
      />
      {/* The answer is stated, and an error is announced, not painted. */}
      <p
        role={state === 'error' || state === 'denied' ? 'alert' : 'status'}
        className="mt-3xs font-data text-caption text-text-secondary"
      >
        {STATE_TEXT[state] ?? ''}
      </p>
      {/* Unsaved text is kept in this browser until it saves or the reader drops it (#1007). */}
      {unsaved ? (
        <button
          ref={discardRef}
          type="button"
          className={`mt-3xs ${quietActionClass}`}
          // Keep focus in the field, so a pointer discard does not save first.
          onMouseDown={(event) => event.preventDefault()}
          onClick={discard}
        >
          Discard unsaved text
        </button>
      ) : null}
    </div>
  );
}
