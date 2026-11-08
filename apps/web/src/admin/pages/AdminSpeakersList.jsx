import { plannerMessage } from '../plannerErrors.js';
import PlannerFeatureControls from '../components/PlannerFeatureControls.jsx';
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import { useAdminApi } from '../adminApi.js';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  linkButtonClass,
  primaryButtonClass,
  rowClass,
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import { ActionFeedback, EditRecordLink, useActionResultFocus } from '../components/ActionFeedback.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  StatusBadge,
  proofRowClass,
} from '../components/adminChrome.jsx';
import { pendingFieldsOf, speakerRecordState } from '../speakerRecord.js';

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
 * The tone under each pipeline word. The word itself is always rendered and
 * is the first signal; the tint is the second one, never the only one
 * (§8.1). An invitation still waiting on its speaker sits on the proof
 * ground, the same tint an unpublished record carries elsewhere in the room.
 */
const PIPELINE_TONES = {
  draft: 'neutral',
  invited: 'draft',
  accepted: 'ok',
  approved: 'ok',
  removed: 'dead',
};

/** The pipeline word, set in a badge whose tone agrees with it. */
function PipelineStatus({ status }) {
  return (
    <StatusBadge tone={PIPELINE_TONES[status] ?? 'neutral'}>
      {PIPELINE_LABELS[status] ?? 'Unknown'}
    </StatusBadge>
  );
}

export default function AdminSpeakersList() {
  const { speakers, loading, error } = useAdminSpeakers();
  const call = useAdminApi();

  const [invites, setInvites] = useState(null); // speakerId → newest invite row
  const [busy, setBusy] = useState(null); // `${speakerId}:${action}`
  const [results, setResults] = useState({});
  const requestPending = useRef(false);
  const actionFocus = useActionResultFocus(busy !== null);
  const setResult = (id, result) => setResults((current) => ({ ...current, [id]: result }));

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
    if (requestPending.current) return;
    requestPending.current = true;
    actionFocus.remember(speaker.id);
    setBusy(`${speaker.id}:${action}`);
    setResult(speaker.id, null);
    const name = speaker.displayName || 'Unnamed speaker';
    try {
      await call(endpoint, { speakerId: speaker.id, ...body });
      setResult(speaker.id, {
        tone: 'ok',
        message: (ACTION_NOTICES[action] ?? ((who) => `Invitation emailed to ${who}.`))(name),
      });
      await refreshInvites();
    } catch (err) {
      // Verbatim: the server's message is the actionable part — which
      // transition it refused, or that the invitation was recorded but not
      // delivered.
      setResult(speaker.id, { tone: 'error', message: plannerMessage(err?.message ?? 'Something went wrong.') });
      await refreshInvites();
    } finally {
      requestPending.current = false;
      setBusy(null);
    }
  }

  function inviteNote(speaker) {
    if (speaker.status !== 'invited') return null;
    const row = invites?.get(speaker.id);
    if (!row) return null;
    if (row.status === 'pending' && !row.sentAt) {
      return 'Invite not sent. Select Resend invite.';
    }
    if (row.status === 'pending' && row.expiresAt) {
      const expires = new Date(row.expiresAt);
      return Number.isFinite(expires.getTime()) ? `Expires ${expires.toLocaleDateString(undefined, { dateStyle: 'medium' })}` : null;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Speakers"
        identifiers={`${speakers.length} record${speakers.length === 1 ? '' : 's'}`}
        description="Edit a speaker here and every session shows the change."
        actions={
          <>
            <Link to="reminders/send" className={secondaryButtonClass}>
              Send reminders
            </Link>
            <Link to="mail/wording" className={secondaryButtonClass}>
              Edit email wording
            </Link>
            <Link to="new" className={primaryButtonClass}>
              Create a speaker
            </Link>
          </>
        }
      />
      <PlannerFeatureControls choices={[{ key: 'speakers', label: 'Speaker directory' }]} />

      {error ? (
        <Notice
          tone="caution"
          message="The list did not refresh. Trying again…"
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading speakers…" />
      ) : speakers.length === 0 ? (
        <AdminEmptyState
          title="No speakers yet"
          description="Add a speaker to start building your program."
          action={
            <Link to="new" className={primaryButtonClass}>
              Create a speaker
            </Link>
          }
        />
      ) : (
        <Panel flush>
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
                  <div className={rowClass}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                        <Link to={speaker.id} className={rowTitleLinkClass}>
                          {speaker.displayName || 'Unnamed speaker'}
                        </Link>
                        <RecordState state={recordState} />
                        <PipelineStatus status={speaker.status} />
                        {speaker.uid ? (
                          <StatusBadge tone="neutral">Account linked</StatusBadge>
                        ) : null}
                        {pendingFieldsOf(speaker).length > 0 ? (
                          <StatusBadge tone="caution">Changes pending review</StatusBadge>
                        ) : null}
                      </div>
                      <p className={`mt-3xs truncate ${rowMetaClass}`}>
                        {[speaker.jobTitle, speaker.organization].filter(Boolean).join(', ') || '—'}
                        {note ? ` · ${note}` : ''}
                      </p>
                      {pendingFieldsOf(speaker).length > 0 ? (
                        <p className="mt-3xs text-admin-sm text-admin-ink-secondary">
                          Speaker-submitted changes awaiting review:{' '}
                          {pendingFieldsOf(speaker).length} profile {pendingFieldsOf(speaker).length === 1 ? 'change' : 'changes'}.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-xs">
                      {speaker.status === 'draft' ? (
                        <button
                          type="button"
                          onClick={() => run('invite', 'sendSpeakerInvite', speaker)}
                          disabled={busy !== null && busy !== `${speaker.id}:invite`}
                          aria-disabled={busy !== null || undefined}
                          aria-busy={busy === `${speaker.id}:invite` || undefined}
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
                            disabled={busy !== null && busy !== `${speaker.id}:resend`}
                            aria-disabled={busy !== null || undefined}
                            aria-busy={busy === `${speaker.id}:resend` || undefined}
                            className={secondaryButtonClass}
                          >
                            {busy === `${speaker.id}:resend` ? 'Resending…' : 'Resend invite'}
                          </button>
                          <button
                            type="button"
                            onClick={() => run('cancel', 'cancelSpeakerInvite', speaker)}
                            disabled={busy !== null && busy !== `${speaker.id}:cancel`}
                            aria-disabled={busy !== null || undefined}
                            aria-busy={busy === `${speaker.id}:cancel` || undefined}
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
                          disabled={busy !== null && busy !== `${speaker.id}:approve`}
                          aria-disabled={busy !== null || undefined}
                          aria-busy={busy === `${speaker.id}:approve` || undefined}
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
                            disabled={busy !== null && busy !== `${speaker.id}:apply`}
                            aria-disabled={busy !== null || undefined}
                            aria-busy={busy === `${speaker.id}:apply` || undefined}
                            className={primaryButtonClass}
                          >
                            {busy === `${speaker.id}:apply` ? 'Applying…' : 'Apply changes'}
                          </button>
                          <DestructiveConfirm
                            trigger="Discard changes"
                            title={`Discard changes from ${speaker.displayName || 'Unnamed speaker'}`}
                            confirmLabel="Discard pending changes"
                            consequence="The speaker’s pending edits are removed. The published profile stays unchanged."
                            busy={busy === `${speaker.id}:discard`}
                            busyLabel="Discarding…"
                            disabled={busy !== null}
                            onConfirm={() => run('discard', 'discardSpeakerPendingEdits', speaker)}
                          />
                        </>
                      ) : null}
                      {speaker.status === 'accepted' || speaker.status === 'approved' ? (
                        <Link
                          to={`reminders/send?speaker=${encodeURIComponent(speaker.id)}`}
                          aria-label={`Remind ${speaker.displayName || 'Unnamed speaker'}`}
                          className={linkButtonClass}
                        >
                          Remind
                        </Link>
                      ) : null}
                      <EditRecordLink to={speaker.id} label={`Edit ${speaker.displayName || 'Unnamed speaker'}`} />
                    </div>
                  </div>
                  <div ref={actionFocus.resultRef(speaker.id)} tabIndex={-1} className="admin-row-result">
                    <ActionFeedback message={results[speaker.id]?.message} tone={results[speaker.id]?.tone} />
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
