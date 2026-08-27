// Speakers list (issue #20): every canonical `speakers/{speakerId}` record
// with its pipeline status, plus the entry points to create and edit — and
// the invite actions the pipeline needs (issue #21).
//
// The list reads the canonical store, not the public projection: an admin
// needs to see the speakers who are NOT published yet (drafts, outstanding
// invites, soft-deleted records), and `speakers_public` holds only the
// approved ones by design (spec §4.3).
//
// Pipeline actions map one-to-one onto the endpoints, and together they are
// the whole path from a new record to the public site:
//   draft     → Invite      (sendSpeakerInvite)
//   invited   → Resend      (resendSpeakerInvite)
//               Cancel      (cancelSpeakerInvite; reverts to draft)
//   accepted  → Approve     (updateSpeaker { status: 'approved' }, which is
//               what publishes `speakers_public` through the onSpeakerWritten
//               projection, spec §4.3)
//   otherwise → no action, because the server refuses those transitions and
//               offering a button the server will reject is worse than
//               offering none.
//
// Approve lives HERE rather than in the editor because the editor shows a
// mid-pipeline status read-only — the pipeline states belong to the
// invitation flow, not to a form that saves every field at once. Without
// this button an accepted speaker had no route to `approved` anywhere in the
// product, so the last step of the pipeline could only be done from a
// console. Removal stays in the editor, which owns the delete/soft-delete
// pair and its too-many-references fallback.
//
// Delivery state comes from listSpeakerInvites rather than from the speaker
// record: `speakers.status` says a speaker was invited, but only the invite
// row knows whether the mail actually went out (spec §4.1) — and an
// invitation that was recorded and never delivered is the one case an
// organizer must be able to see, because the speaker is waiting for mail
// that will never arrive.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import { useAdminApi } from '../adminApi.js';
import {
  Notice,
  Panel,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  proofRowClass,
} from '../components/adminChrome.jsx';
import { deadMatter, state } from '../recordState.js';

/**
 * Where a speaker is in the INVITATION pipeline. This is a different axis
 * from the record's publish state below, and it keeps its own words because
 * collapsing "invite sent" into "Draft" would throw away the one fact an
 * organizer is watching for.
 */
const PIPELINE_LABELS = {
  draft: 'Not invited',
  invited: 'Invite sent',
  accepted: 'Accepted',
  approved: 'Approved',
  removed: 'Removed',
};

/**
 * The speaker's record state, in the admin's three words (brief §5.2). A
 * speaker is on the public site only once they are approved, and an
 * approved speaker with self-service edits waiting for review is exactly
 * the third state. A removed speaker is dead matter: it keeps its word.
 */
function speakerRecordState(speaker) {
  if (speaker.status === 'removed') return deadMatter('Removed');
  if (speaker.status !== 'approved') return state('draft');
  return pendingFieldsOf(speaker).length > 0 ? state('dirty') : state('live');
}

/**
 * Field names queued in `speaker.pendingEdits` (spec §4.3, issue #22
 * review finding P1-1) — an approved speaker's self-service edit that
 * onSpeakerWritten deliberately did NOT publish, awaiting an admin's
 * apply/discard decision (functions/src/speakers/profile.cjs).
 */
function pendingFieldsOf(speaker) {
  const pending = speaker?.pendingEdits;
  return pending && typeof pending === 'object' ? Object.keys(pending) : [];
}

/** The pipeline word, in the data face. Never a coloured pill. */
function PipelineStatus({ status }) {
  return (
    <span className="font-admin-data text-folio text-admin-ink-data">
      {PIPELINE_LABELS[status] ?? status ?? 'Unknown'}
    </span>
  );
}

export default function AdminSpeakersList() {
  const { speakers, loading, error } = useAdminSpeakers();
  const call = useAdminApi();

  const [invites, setInvites] = useState(null); // speakerId → newest invite row
  const [busy, setBusy] = useState(null); // `${speakerId}:${action}`
  const [notice, setNotice] = useState(null); // { kind: 'ok'|'error', message }

  const refreshInvites = useCallback(async () => {
    try {
      const { invites: rows } = await call('listSpeakerInvites', {});
      const newest = new Map();
      // Rows arrive newest-first, so the first row per speaker wins.
      for (const row of rows ?? []) {
        if (row?.speakerId && !newest.has(row.speakerId)) newest.set(row.speakerId, row);
      }
      setInvites(newest);
    } catch {
      // Non-blocking: the list itself still renders, it just cannot show
      // delivery state. Nothing here is an authorization boundary.
      setInvites(new Map());
    }
  }, [call]);

  useEffect(() => {
    refreshInvites();
  }, [refreshInvites]);

  const ACTION_NOTICES = {
    cancel: (name) => `Invitation to ${name} cancelled.`,
    approve: (name) => `${name} approved — they now appear on the public site.`,
    apply: (name) => `${name}'s changes are now live.`,
    discard: (name) => `${name}'s pending changes were discarded.`,
  };

  async function run(action, endpoint, speaker, body = {}) {
    setBusy(`${speaker.id}:${action}`);
    setNotice(null);
    const name = speaker.displayName || speaker.id;
    try {
      await call(endpoint, { speakerId: speaker.id, ...body });
      setNotice({
        kind: 'ok',
        message: (ACTION_NOTICES[action] ?? ((who) => `Invitation emailed to ${who}.`))(name),
      });
      await refreshInvites();
    } catch (err) {
      // Verbatim: the server's message is the actionable part — which
      // transition it refused, or that the invitation was recorded but not
      // delivered.
      setNotice({ kind: 'error', message: err?.message ?? 'Something went wrong.' });
      await refreshInvites();
    } finally {
      setBusy(null);
    }
  }

  function inviteNote(speaker) {
    if (speaker.status !== 'invited') return null;
    const row = invites?.get(speaker.id);
    if (!row) return null;
    if (row.status === 'pending' && !row.sentAt) {
      return 'Recorded, not delivered — resend it';
    }
    if (row.status === 'pending' && row.expiresAt) {
      return `Expires ${row.expiresAt.slice(0, 10)}`;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Speakers"
        identifiers={`${speakers.length} record${speakers.length === 1 ? '' : 's'}`}
        description="One record per speaker. Sessions reference these records by id, so editing a name here updates it everywhere it appears."
        actions={
          <Link to="new" className={primaryButtonClass}>
            Create a speaker
          </Link>
        }
      />

      {error ? (
        <Notice
          tone="caution"
          message="We lost the connection to the speaker list; showing the last values we received and retrying."
        />
      ) : null}

      {notice ? (
        <Notice tone={notice.kind === 'error' ? 'error' : 'ok'} message={notice.message} />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading speakers…" />
      ) : speakers.length === 0 ? (
        <AdminEmptyState
          title="No speakers yet"
          description="Add the first speaker — a name is all that's required; the rest can follow."
          action={
            <Link to="new" className={primaryButtonClass}>
              Create a speaker
            </Link>
          }
        />
      ) : (
        <Panel className="p-0">
          <ul>
            {speakers.map((speaker) => {
              const note = inviteNote(speaker);
              const recordState = speakerRecordState(speaker);
              return (
                <li
                  key={speaker.id}
                  className={`border-admin-rule-hairline border-b-admin-hairline last:border-b-0 ${proofRowClass(
                    recordState.id,
                  )}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-sm px-md py-xs">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-sm gap-y-3xs">
                      <Link
                        to={speaker.id}
                        className="admin-target inline-flex items-center rounded-admin font-semibold text-admin-ink underline underline-offset-4"
                      >
                        {speaker.displayName || speaker.id}
                      </Link>
                      <RecordState state={recordState} />
                      <PipelineStatus status={speaker.status} />
                      {speaker.uid ? (
                        <span className="font-admin-data text-folio text-admin-ink-secondary">
                          Account linked
                        </span>
                      ) : null}
                      {pendingFieldsOf(speaker).length > 0 ? (
                        <span className="font-admin-data text-folio text-admin-state-caution">
                          Changes pending review
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3xs truncate font-admin-data text-folio text-admin-ink-data">
                      {[speaker.jobTitle, speaker.organization].filter(Boolean).join(', ') || '—'}
                      {' · '}
                      {speaker.slug}
                      {note ? ` · ${note}` : ''}
                    </p>
                    {pendingFieldsOf(speaker).length > 0 ? (
                      <p className="mt-3xs text-caption text-admin-ink-secondary">
                        Speaker-submitted changes awaiting review:{' '}
                        {pendingFieldsOf(speaker).join(', ')}.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-xs">
                    {speaker.status === 'draft' ? (
                      <button
                        type="button"
                        onClick={() => run('invite', 'sendSpeakerInvite', speaker)}
                        disabled={busy === `${speaker.id}:invite`}
                        className={secondaryButtonClass}
                      >
                        {busy === `${speaker.id}:invite` ? 'Inviting…' : 'Invite'}
                      </button>
                    ) : null}
                    {speaker.status === 'invited' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => run('resend', 'resendSpeakerInvite', speaker)}
                          disabled={busy === `${speaker.id}:resend`}
                          className={secondaryButtonClass}
                        >
                          {busy === `${speaker.id}:resend` ? 'Resending…' : 'Resend invite'}
                        </button>
                        <button
                          type="button"
                          onClick={() => run('cancel', 'cancelSpeakerInvite', speaker)}
                          disabled={busy === `${speaker.id}:cancel`}
                          className={linkButtonClass}
                        >
                          {busy === `${speaker.id}:cancel` ? 'Cancelling…' : 'Cancel invite'}
                        </button>
                      </>
                    ) : null}
                    {speaker.status === 'accepted' ? (
                      <button
                        type="button"
                        onClick={() =>
                          run('approve', 'updateSpeaker', speaker, { speaker: { status: 'approved' } })
                        }
                        disabled={busy === `${speaker.id}:approve`}
                        className={primaryButtonClass}
                      >
                        {busy === `${speaker.id}:approve` ? 'Approving…' : 'Approve'}
                      </button>
                    ) : null}
                    {pendingFieldsOf(speaker).length > 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => run('apply', 'applySpeakerPendingEdits', speaker)}
                          disabled={busy === `${speaker.id}:apply`}
                          className={primaryButtonClass}
                        >
                          {busy === `${speaker.id}:apply` ? 'Applying…' : 'Apply changes'}
                        </button>
                        <button
                          type="button"
                          onClick={() => run('discard', 'discardSpeakerPendingEdits', speaker)}
                          disabled={busy === `${speaker.id}:discard`}
                          className={linkButtonClass}
                        >
                          {busy === `${speaker.id}:discard` ? 'Discarding…' : 'Discard changes'}
                        </button>
                      </>
                    ) : null}
                    <Link to={speaker.id} className={secondaryButtonClass}>
                      Edit
                    </Link>
                  </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
