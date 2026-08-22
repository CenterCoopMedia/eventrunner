// Speakers list (issue #20): every canonical `speakers/{speakerId}` record
// with its pipeline status, plus the entry points to create and edit.
//
// The list reads the canonical store, not the public projection: an admin
// needs to see the speakers who are NOT published yet (drafts, outstanding
// invites, soft-deleted records), and `speakers_public` holds only the
// approved ones by design (spec §4.3).
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
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

export default function AdminSpeakersList() {
  const { speakers, loading, error } = useAdminSpeakers();

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
            {speakers.map((speaker) => (
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
                  </p>
                </div>
                <Link to={speaker.id} className={secondaryButtonClass}>
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
