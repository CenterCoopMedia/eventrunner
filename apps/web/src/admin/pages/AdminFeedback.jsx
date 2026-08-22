// Feedback review tab (issue #28, spec §9 "Feedback inbox") — every
// submission from the public feedback modal, newest first, with a
// mark-reviewed/archived action. Reads `feedback` directly (firestore.rules:
// isAdmin() read) the same way AdminPagesList reads cmsPages; only the
// status write goes through the admin endpoint (updateFeedbackStatus),
// because firestore.rules deny every client write to the collection.
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import { Panel, SelectField, secondaryButtonClass } from '../components/formControls.jsx';

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'archived', label: 'Archived' },
];

const STATUS_FILTERS = [
  { value: 'open', label: 'Open (new + reviewed)' },
  { value: 'all', label: 'All' },
  ...STATUS_OPTIONS,
];

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

const STATUS_CLASSES = {
  new: 'border-warning/40 bg-warning/10 text-warning',
  reviewed: 'border-success/40 bg-success/10 text-success',
  archived: 'border-brand-ink/20 bg-brand-surface-alt text-brand-ink-muted',
};

export default function AdminFeedback() {
  const call = useAdminApi();
  const { showToast } = useToast();

  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  const [filter, setFilter] = useState('open');
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    return subscribeAdminCollection(
      'feedback',
      (docs) => { setRows(docs); setListError(null); },
      setListError,
    );
  }, []);

  const ordered = useMemo(() => {
    if (!rows) return [];
    const filtered = rows.filter((row) => {
      if (filter === 'all') return true;
      if (filter === 'open') return row.status !== 'archived';
      return row.status === filter;
    });
    return filtered.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  }, [rows, filter]);

  async function setStatus(id, status) {
    setUpdatingId(id);
    try {
      await call('updateFeedbackStatus', { id, status });
      showToast('Feedback updated.');
    } catch (err) {
      showToast(err.message, { tone: 'error' });
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand-ink">Feedback</h1>
          <p className="text-sm text-brand-ink-muted">
            Bug reports and feedback submitted through the public site.
          </p>
        </div>
        <div className="w-full max-w-xs sm:w-auto">
          <SelectField label="Show" value={filter} onChange={setFilter} options={STATUS_FILTERS} />
        </div>
      </div>

      {listError ? (
        <p role="status" className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          We lost the connection to the feedback list; showing the last values we received and
          retrying.
        </p>
      ) : null}

      {rows === null ? (
        <LoadingState label="Loading feedback…" />
      ) : ordered.length === 0 ? (
        <EmptyState title="Nothing here" description="No feedback matches this filter." />
      ) : (
        <Panel>
          <ul className="divide-y divide-brand-ink/10">
            {ordered.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-brand border px-2 py-1 text-xs font-semibold ${
                        STATUS_CLASSES[row.status] ?? STATUS_CLASSES.new
                      }`}
                    >
                      {row.status ?? 'new'}
                    </span>
                    <span className="text-xs text-brand-ink-muted">{row.category ?? 'feedback'}</span>
                    <span className="text-xs text-brand-ink-muted">
                      {toDate(row.createdAt)?.toLocaleString() ?? ''}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-brand-ink">{row.message}</p>
                  {row.email ? (
                    <p className="mt-1 text-sm text-brand-ink-muted">
                      <a href={`mailto:${row.email}`} className="underline underline-offset-2 hover:text-brand-ink">
                        {row.email}
                      </a>
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {/* Only a `new` row offers "Mark reviewed" — showing it on
                      an archived row would silently unarchive on click
                      (status would jump straight to reviewed with no
                      intermediate state to undo it from). */}
                  {row.status === 'new' ? (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => setStatus(row.id, 'reviewed')}
                      disabled={updatingId === row.id}
                    >
                      Mark reviewed
                    </button>
                  ) : null}
                  {row.status !== 'archived' ? (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => setStatus(row.id, 'archived')}
                      disabled={updatingId === row.id}
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => setStatus(row.id, 'new')}
                      disabled={updatingId === row.id}
                    >
                      Restore
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
