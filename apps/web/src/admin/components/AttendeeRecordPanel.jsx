// One attendee's organizer record (issue #185), opened from a row on the
// Attendees page: the fields an organizer owns and the attendee cannot
// change, and the account delete.
//
// Both go through server endpoints (functions/src/users/records.cjs). The
// rules give an admin no client write on `users` at all, and deny
// `pastAttendance` to its own owner, so there is no other path.
//
// The delete is the one destructive moment on the page. It states what goes
// and what stays before it acts, and a speaker-linked account cannot start
// it: the speaker record owns that link and is deleted first. What happens
// after a delete lives on the PAGE, not here — the row, and this panel with
// it, leaves the list the moment the account document is gone, which is
// often before the call answers. So the panel reports every outcome up, and
// the page decides where it shows: a refusal made before anything was
// deleted comes back here as `deleteError`; everything else, including a
// failure the server never shaped, stays on the page with a retry.
import { useEffect, useRef, useState } from 'react';
import { useAdminApi } from '../adminApi.js';
import {
  DestructiveConfirm,
  Notice,
  SaveStatus,
  ServerErrorSummary,
  TextAreaField,
  fieldHintClass,
  linkButtonClass,
  primaryButtonClass,
} from './formControls.jsx';

/** The name a person reads for a row: display name, then address, then id. */
export function attendeeName(row) {
  return row?.displayName || row?.email || row?.id || '';
}

/** A DOM id for the panel of one account. */
export function recordPanelId(uid) {
  return `attendee-record-${String(uid).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** The stored list as the text area's lines. */
function toLines(pastAttendance) {
  return Array.isArray(pastAttendance)
    ? pastAttendance.filter((entry) => typeof entry === 'string').join('\n')
    : '';
}

/** The text area's lines as the list the server takes: trimmed, no blanks. */
function toList(lines) {
  return lines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export const SPEAKER_LINKED_REASON = 'This account is linked to a speaker. Delete the speaker record first.';

/** The 409 codes deleteAttendee answers before its transaction commits. */
const REFUSED_BEFORE_DELETE_CODES = Object.freeze(['own-account', 'admin-account', 'speaker-linked', 'too-many-claims']);

/**
 * Whether a failed delete was refused before the server removed anything:
 * a refusal (409) the delete names, a request the gate or the validation
 * turned away (400, 401, 403), or one of the server's own 500 answers
 * (`internal`), which it sends only before the directory commit or on a
 * resumed delete. Anything else — `delete-incomplete`, a gateway timeout,
 * a dropped connection, a body that is not the server's — may have come
 * after the commit, so the page keeps a retry for it.
 *
 * @param {{ code?: string, status?: number } | null | undefined} error
 * @returns {boolean}
 */
export function refusedBeforeDelete(error) {
  const status = error?.status;
  if (status === 400 || status === 401 || status === 403) return true;
  if (status === 409) return REFUSED_BEFORE_DELETE_CODES.includes(error.code);
  return status === 500 && error.code === 'internal';
}

/**
 * The quiet control on the row face that opens and closes the panel.
 *
 * @param {{ open: boolean, uid: string, onToggle: () => void }} props
 */
export function AttendeeRecordToggle({ open, uid, onToggle }) {
  return (
    <button
      type="button"
      className={linkButtonClass}
      aria-expanded={open ? 'true' : 'false'}
      aria-controls={recordPanelId(uid)}
      onClick={onToggle}
    >
      Edit record
    </button>
  );
}

/**
 * @param {object} props
 * @param {object} props.row the account, as the page's `users` listener delivers it
 * @param {Error|null} [props.deleteError] a refusal the page hands back to this row
 * @param {(uid: string) => void} [props.onDeleteStart]
 * @param {(result: { uid: string, name: string }) => void} props.onDeleted
 * @param {(result: { uid: string, name: string, error: Error }) => void} props.onDeleteFailed
 *   every failure, whatever its shape; the page decides where it shows
 */
export default function AttendeeRecordPanel({
  row, deleteError = null, onDeleteStart, onDeleted, onDeleteFailed,
}) {
  const call = useAdminApi();
  const name = attendeeName(row);

  const [lines, setLines] = useState(() => toLines(row.pastAttendance));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);

  const [deleting, setDeleting] = useState(false);
  const deleteErrorRef = useRef(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (deleteError) deleteErrorRef.current?.focus();
  }, [deleteError]);

  const fieldError = (error?.fieldErrors ?? []).find((segment) =>
    segment.field?.startsWith('pastAttendance'),
  )?.message;

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus('');
    const pastAttendance = toList(lines);
    try {
      const result = await call('updateAttendee', { uid: row.id, pastAttendance });
      setLines(toLines(Array.isArray(result?.pastAttendance) ? result.pastAttendance : pastAttendance));
      setStatus('Past attendance saved.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    onDeleteStart?.(row.id);
    try {
      await call('deleteAttendee', { uid: row.id });
      onDeleted?.({ uid: row.id, name });
    } catch (err) {
      onDeleteFailed?.({ uid: row.id, name, error: err });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section
      id={recordPanelId(row.id)}
      aria-label={`Record for ${name}`}
      className="flex flex-col gap-md border-admin-rule-hairline border-t-admin-hairline px-md py-sm"
    >
      <form className="flex max-w-[65ch] flex-col gap-sm" onSubmit={save}>
        <ServerErrorSummary error={error} errorRef={errorRef} />
        <TextAreaField
          label="Past attendance"
          hint="One edition per line, such as a year. Attendees cannot change this list. It is part of the export."
          value={lines}
          onChange={setLines}
          error={fieldError}
          rows={3}
        />
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="submit"
            className={primaryButtonClass}
            disabled={saving}
            aria-busy={saving ? 'true' : undefined}
          >
            {saving ? 'Saving…' : 'Save record'}
          </button>
          {status ? <SaveStatus message={status} /> : null}
        </div>
      </form>

      <div className="flex flex-col gap-xs">
        {row.speakerId ? <p className={fieldHintClass}>{SPEAKER_LINKED_REASON}</p> : null}
        <div>
          <DestructiveConfirm
            trigger="Delete account"
            title={`Delete the account for ${name}`}
            confirmLabel="Delete this account"
            busyLabel="Deleting…"
            busy={deleting}
            disabled={Boolean(row.speakerId) || deleting}
            consequence="This removes the account, its directory profile, its shared schedule, its sign-in, its saved sessions, its private notes, its profile photo, its change requests, and its ticket claim. The ticket record, sent email records, feedback, session reactions, and the admin log stay."
            permanence="This cannot be undone."
            onConfirm={deleteAccount}
          />
        </div>
        {deleteError ? (
          <div ref={deleteErrorRef} tabIndex={-1}>
            <Notice tone="error" message={deleteError.message} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
