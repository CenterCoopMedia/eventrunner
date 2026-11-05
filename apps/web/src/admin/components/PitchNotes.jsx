// Staff review notes on one pitch, one signed entry per note
// (functions/src/sessions/pitchNotes.cjs). Anyone on staff adds a note;
// only its author can edit it. The list comes from the live pitch row, so a
// note another reviewer adds appears without a reload. A note does not
// change the pitch revision, so it never blocks a decision.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
  SaveStatus, ServerErrorSummary, TextAreaField, linkButtonClass, secondaryButtonClass,
} from './formControls.jsx';

const MAX_LENGTH = 5000;

function toDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function when(value) {
  const date = toDate(value);
  return date ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function NoteEntry({ note, mine, busy, onSave, feedback }) {
  const [draft, setDraft] = useState(null);
  // The text the edit started from; the server refuses the save if it changed.
  const [base, setBase] = useState('');
  if (draft !== null) {
    return (
      <li className="flex flex-col gap-xs">
        <TextAreaField label="Edit your note" value={draft} onChange={setDraft} maxLength={MAX_LENGTH} rows={3} disabled={busy} />
        <div className="flex flex-wrap gap-xs">
          <button type="button" className={secondaryButtonClass} disabled={busy || !draft.trim()}
            onClick={async () => { if (await onSave(note.id, draft, base)) setDraft(null); }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className={linkButtonClass} disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
        </div>
        {feedback}
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-3xs border-b-admin-hairline border-admin-rule-hairline pb-sm last:border-b-0">
      <p className="text-admin-sm text-admin-ink-secondary">
        <span className="font-semibold text-admin-ink">{mine ? 'You' : note.email || 'Staff'}</span>
        {note.createdAt ? ` · ${when(note.createdAt)}` : ''}
        {note.editedAt ? ' · edited' : ''}
      </p>
      <p className="whitespace-pre-line">{note.text}</p>
      {mine ? (
        <div><button type="button" className={linkButtonClass} disabled={busy} onClick={() => { setBase(note.text); setDraft(note.text); }}>Edit</button></div>
      ) : null}
      {feedback}
    </li>
  );
}

/**
 * @param {{ pitch: object, call: Function }} props pitch is the live row
 */
export default function PitchNotes({ pitch, call }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  // Which control the last result belongs to: 'add' or a note id.
  const [where, setWhere] = useState('add');
  // A note saved here shows at once, before the live row catches up.
  const [local, setLocal] = useState({});
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const stored = Array.isArray(pitch.reviewNotes) ? pitch.reviewNotes : [];
  // The local copy wins only until the live row has the same or a later
  // version, so an edit made elsewhere is never hidden.
  const notes = stored.map((note) => {
    const mine = local[note.id];
    const version = (each) => toDate(each.editedAt ?? each.createdAt)?.getTime() ?? 0;
    return mine && version(mine) > version(note) ? mine : note;
  });
  for (const note of Object.values(local)) if (!stored.some((each) => each.id === note.id)) notes.push(note);

  async function save(request, message) {
    if (busy) return false;
    setBusy(true); setError(null); setStatus(''); setWhere(request.noteId ?? 'add');
    try {
      const { note } = await call('saveSessionPitchNote', { id: pitch.id, ...request });
      setLocal((previous) => ({ ...previous, [note.id]: note }));
      setStatus(message);
      return true;
    } catch (err) { setError(err); return false; } finally { setBusy(false); }
  }

  async function add(event) {
    event.preventDefault();
    if (await save({ action: 'add', text }, 'Note added.')) setText('');
  }

  const feedback = (
    <>
      <ServerErrorSummary error={error} errorRef={errorRef} title="The note was not saved" />
      {status ? <SaveStatus message={status} /> : null}
    </>
  );

  return (
    <div className="flex flex-col gap-md">
      {pitch.privateNotes || notes.length ? (
        <ul className="flex flex-col gap-sm">
          {pitch.privateNotes ? (
            <li className="flex flex-col gap-3xs border-b-admin-hairline border-admin-rule-hairline pb-sm">
              <p className="text-admin-sm text-admin-ink-secondary"><span className="font-semibold text-admin-ink">Earlier note</span> · no name recorded</p>
              <p className="whitespace-pre-line">{pitch.privateNotes}</p>
            </li>
          ) : null}
          {notes.map((note) => (
            <NoteEntry key={note.id} note={note} mine={Boolean(user?.uid) && note.uid === user.uid} busy={busy}
              feedback={where === note.id ? feedback : null}
              onSave={(noteId, draft, baseText) => save({ action: 'edit', noteId, text: draft, baseText }, 'Note updated.')} />
          ))}
        </ul>
      ) : (
        <p className="text-admin-sm text-admin-ink-secondary">No notes yet.</p>
      )}
      <form onSubmit={add} className="flex flex-col gap-sm">
        <TextAreaField label="Add a note" value={text} onChange={setText} maxLength={MAX_LENGTH} rows={3} disabled={busy} />
        <div><button type="submit" className={secondaryButtonClass} disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Add note'}</button></div>
        {where === 'add' ? feedback : null}
      </form>
    </div>
  );
}
