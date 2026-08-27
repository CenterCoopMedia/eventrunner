// Feedback review tab (issue #28, spec §9 "Feedback inbox") — every
// submission from the public feedback modal, newest first, with a
// mark-reviewed/archived action. Reads `feedback` directly (firestore.rules:
// isAdmin() read) the same way AdminPagesList reads cmsPages; only the
// status write goes through the admin endpoint (updateFeedbackStatus),
// because firestore.rules deny every client write to the collection.
//
// Restyled onto the fixed admin identity (docs/plans/2026-08-27-admin-
// identity-story.md): the job line via AdminPageHeader, the galley for the
// row list (hairline rows, mono data, no zebra, no row cards), and the
// status word set in the data face with its own ink — never a coloured
// pill — because a state is always a word first and colour is never the
// only signal (§8.1). An archived row is dead matter: it drops to the
// standing-matter ink and keeps its word.
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import {
  Notice,
  Panel,
  SelectField,
  linkButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { AdminEmptyState, AdminLoadingState } from '../components/adminChrome.jsx';

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

// The status ink. The word (rendered verbatim below) is always the first
// signal; this is the second one, never the only one. `archived` drops to
// the disabled ink because an archived submission is dead matter — it keeps
// its word rather than being hidden (admin story part 2).
const STATUS_INK = Object.freeze({
  new: 'text-admin-state-caution',
  reviewed: 'text-admin-state-ok',
  archived: 'text-admin-ink-disabled',
});

// One word per status, spelled the same way everywhere it appears (§8.5) —
// the row badge below used to render the raw lowercase status value, which
// read as a different word from this same list's Title Case options.
const STATUS_LABELS = Object.freeze(
  Object.fromEntries(STATUS_OPTIONS.map((option) => [option.value, option.label])),
);

export default function AdminFeedback() {
  const call = useAdminApi();
  const { showToast } = useToast();

  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  const [filter, setFilter] = useState('open');
  const [updatingId, setUpdatingId] = useState(null);
  // A failed status change used to be a toast and nothing else. A toast
  // leaves, and when it does there is no record that the write failed —
  // the row simply still says what it said before, which reads as "nothing
  // happened" rather than "this did not save" (admin story part 5: a
  // result is stated in place, beside the control that caused it, and it
  // stays). The toast still fires; it is no longer the only record.
  const [statusError, setStatusError] = useState(null);

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
    setStatusError(null);
    try {
      await call('updateFeedbackStatus', { id, status });
      showToast('Feedback updated.');
    } catch (err) {
      setStatusError({ id, message: err.message });
      showToast(err.message, { tone: 'error' });
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Feedback"
        description="Bug reports and feedback submitted through the public site."
        actions={
          <div className="w-full max-w-xs sm:w-auto">
            <SelectField label="Show" value={filter} onChange={setFilter} options={STATUS_FILTERS} />
          </div>
        }
      />

      {listError ? (
        <Notice
          tone="caution"
          message="We lost the connection to the feedback list; showing the last values we received and retrying."
        />
      ) : null}

      {rows === null ? (
        <AdminLoadingState label="Loading feedback…" />
      ) : ordered.length === 0 ? (
        <AdminEmptyState title="Nothing here" description="No feedback matches this filter." />
      ) : (
        <Panel flush>
          <ul>
            {ordered.map((row) => (
              <li
                key={row.id}
                className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-sm px-md py-xs">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-3xs">
                      <span
                        className={`font-admin-data text-folio font-semibold ${
                          STATUS_INK[row.status] ?? STATUS_INK.new
                        }`}
                      >
                        {STATUS_LABELS[row.status] ?? STATUS_LABELS.new}
                      </span>
                      <span className="font-admin-data text-folio text-admin-ink-secondary">
                        {row.category ?? 'feedback'}
                      </span>
                      <span className="font-admin-data text-folio text-admin-ink-secondary">
                        {toDate(row.createdAt)?.toLocaleString() ?? ''}
                      </span>
                    </div>
                    <p className="mt-3xs whitespace-pre-wrap text-caption text-admin-ink">{row.message}</p>
                    {row.email ? (
                      <a href={`mailto:${row.email}`} className={`mt-3xs ${linkButtonClass}`}>
                        {row.email}
                      </a>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2xs">
                    {/* The failure stays beside the buttons that caused it,
                        on the row it belongs to, until the next attempt. */}
                    {statusError?.id === row.id ? (
                      <Notice tone="error" message={`This did not save. ${statusError.message}`} />
                    ) : null}
                    <div className="flex flex-wrap gap-xs">
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
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
