// RecordingLink — "Watch the recording", when a session has one.
//
// The link lives on the session record (`recordingUrl`, validated server
// side in functions/src/schedule/sessions.cjs), not in a lookup table keyed
// by session id. A table like that goes stale the moment a session is
// renamed, and an operator editing the schedule has no reason to expect a
// second place to edit.
//
// One plain labelled link in the data face, the same shape every other row
// control takes. No icon, no provider name, no coloured badge: the reader
// is told what the link does, and a session with no recording says nothing
// at all rather than promising one later.
//
// It stays on a back issue. Every other live control comes off a finished
// day (SessionActions), but a recording is what a finished session left
// behind, exactly like its materials.
import { isSafeUrl } from 'shared/urlSafety';
import { rowActionClass } from './sessionActionClass.js';

/**
 * The session's recording link, or '' when it has none this page may open.
 *
 * The protocol allowlist runs again here, at render time. The server
 * already refuses an unsafe link at the write seam, so this should never
 * fire — but a session written before that check existed, or restored from
 * a backup, must not turn into a `javascript:` target under a reader's
 * cursor. Same belt-and-braces rule SessionMaterialsList applies to a
 * resolved material URL.
 *
 * @param {{ recordingUrl?: unknown } | null | undefined} session
 * @returns {string}
 */
export function sessionRecordingUrl(session) {
  const raw = session?.recordingUrl;
  const url = typeof raw === 'string' ? raw.trim() : '';
  return url && isSafeUrl(url) ? url : '';
}

/**
 * @param {{ session: object }} props
 */
export default function RecordingLink({ session }) {
  const url = sessionRecordingUrl(session);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={rowActionClass}>
      Watch the recording
      {/* Which session's recording. A schedule day can list thirty rows,
          and a reader pulling up the links on the page would otherwise
          meet thirty identical "Watch the recording" entries with nothing
          to tell them apart. The row says it by position to anyone who can
          see it; this says it to everyone else. */}
      {session?.title ? <span className="sr-only">{` of ${session.title}`}</span> : null}
    </a>
  );
}
