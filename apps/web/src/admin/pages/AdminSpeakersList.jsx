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
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import { useAdminApi } from '../adminApi.js';
import { Panel, primaryButtonClass, secondaryButtonClass } from '../components/formControls.jsx';

const STATUS_LABELS = {
  draft: 'Not invited',
  invited: 'Invite sent',
  accepted: 'Accepted',
  approved: 'Published',
  removed: 'Removed',
};

const STATUS_CLASSES = {
  approved: 'border-success/40 bg-success/10 text-success',
  invited: 'border-warning/40 bg-warning/10 text-warning',
  accepted: 'border-warning/40 bg-warning/10 text-warning',
  removed: 'border-danger/40 bg-danger/10 text-danger',
  draft: 'border-brand-ink/20 bg-brand-surface-alt text-brand-ink-muted',
};

function StatusChip({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-brand border px-2 py-1 text-xs font-semibold ${
        STATUS_CLASSES[status] ?? STATUS_CLASSES.draft
      }`}
    >
      {STATUS_LABELS[status] ?? status ?? 'Unknown'}
    </span>
  );
}

const linkButtonClass =
  'touch-target inline-flex items-center rounded-brand px-2 py-1 underline ' +
  'underline-offset-2 text-brand-ink-muted hover:text-brand-ink disabled:opacity-60';

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand-ink">Speakers</h1>
          <p className="text-sm text-brand-ink-muted">
            One record per speaker. Sessions reference these records by id, so
            editing a name here updates it everywhere it appears.
          </p>
        </div>
        <Link to="new" className={primaryButtonClass}>
          New speaker
        </Link>
      </div>

      {error ? (
        <p role="status" className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          We lost the connection to the speaker list; showing the last values we
          received and retrying.
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className={`rounded-brand border px-3 py-2 text-sm ${
            notice.kind === 'error'
              ? 'border-danger/40 bg-danger/10 text-danger'
              : 'border-success/40 bg-success/10 text-success'
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      {loading ? (
        <LoadingState label="Loading speakers…" />
      ) : speakers.length === 0 ? (
        <EmptyState
          title="No speakers yet"
          description="Add the first speaker — a name is all that's required; the rest can follow."
          action={
            <Link to="new" className={primaryButtonClass}>
              New speaker
            </Link>
          }
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-brand-ink/10">
            {speakers.map((speaker) => {
              const note = inviteNote(speaker);
              return (
                <li key={speaker.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={speaker.id}
                        className="touch-target inline-flex items-center rounded-brand font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-primary-dark"
                      >
                        {speaker.displayName || speaker.id}
                      </Link>
                      <StatusChip status={speaker.status} />
                      {speaker.uid ? (
                        <span className="rounded-brand border border-brand-ink/20 px-2 py-1 text-xs text-brand-ink-muted">
                          Account linked
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-brand-ink-muted">
                      {[speaker.jobTitle, speaker.organization].filter(Boolean).join(', ') || '—'}
                      {' · '}
                      {speaker.slug}
                      {note ? ` · ${note}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                    <Link to={speaker.id} className={secondaryButtonClass}>
                      Edit
                    </Link>
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
