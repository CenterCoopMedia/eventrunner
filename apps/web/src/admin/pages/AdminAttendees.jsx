// Attendee registration tab (issue #32, spec §3.4) — the surface where an
// organizer approves a scholarship attendee, a volunteer, or a press pass,
// and revokes access when someone should no longer have it.
//
// Reads `users` directly (firestore.rules: isAdmin() read) the same way
// AdminFeedback reads `feedback`; both state writes go through the admin
// endpoints (approveUser / revokeUser), because every registration field is
// server-owned — firestore.rules deny a client write to registrationStatus
// and approvalSource even for the account's own owner.
//
// The buttons offered per row mirror the §3.4 transition table exactly, so
// the UI never invites a click the server will answer 409 to:
//   pending   → Approve
//   ticketed  → Approve, Revoke
//   approved  → Revoke (and Approve again only while the grant came from a
//               ticket, where re-approving pins approvalSource to 'admin' so
//               a later refund cannot reverse it)
//   revoked   → Approve (admin re-approval — the only way out of revoked;
//               a ticket sync never undoes a revocation)
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import {
  DestructiveConfirm,
  Panel,
  SelectField,
  TextField,
  secondaryButtonClass,
} from '../components/formControls.jsx';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'ticketed', label: 'Ticketed' },
  { value: 'approved', label: 'Approved' },
  { value: 'revoked', label: 'Revoked' },
];

const STATUS_CLASSES = {
  pending: 'border-brand-ink/20 bg-brand-surface-alt text-brand-ink-muted',
  ticketed: 'border-warning/40 bg-warning/10 text-warning',
  approved: 'border-success/40 bg-success/10 text-success',
  revoked: 'border-danger/40 bg-danger/10 text-danger',
};

/** Rows an organizer can act on, per the §3.4 table. */
function canApprove(row) {
  if (row.registrationStatus === 'approved') return row.approvalSource !== 'admin';
  return ['pending', 'ticketed', 'revoked'].includes(row.registrationStatus);
}

function canRevoke(row) {
  return ['ticketed', 'approved'].includes(row.registrationStatus);
}

function matchesSearch(row, needle) {
  if (!needle) return true;
  const haystack = [row.displayName, row.email, row.organization, row.id]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export default function AdminAttendees() {
  const call = useAdminApi();
  const { showToast } = useToast();

  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busyUid, setBusyUid] = useState(null);

  useEffect(() => {
    return subscribeAdminCollection(
      'users',
      (docs) => { setRows(docs); setListError(null); },
      setListError,
    );
  }, []);

  const shown = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    return rows
      .filter((row) => (filter === 'all' ? true : row.registrationStatus === filter))
      .filter((row) => matchesSearch(row, needle))
      .sort((a, b) => (a.displayName || a.email || a.id).localeCompare(b.displayName || b.email || b.id));
  }, [rows, filter, search]);

  async function act(endpoint, uid) {
    setBusyUid(uid);
    try {
      const result = await call(endpoint, { uid });
      showToast(
        result?.changed === false
          ? 'That account was already in this state.'
          : `Registration set to ${result?.registrationStatus ?? 'updated'}.`,
      );
    } catch (err) {
      showToast(err.message, { tone: 'error' });
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">Attendees</h1>
        <p className="text-sm text-brand-ink-muted">
          Registration status for every account. An approval you make here is recorded as an
          organizer decision and survives a ticket refund; a revocation is never undone by a later
          ticket sync.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <TextField
            label="Search"
            value={search}
            onChange={setSearch}
            type="search"
            placeholder="Name, email, or organization"
          />
        </div>
        <div className="w-full max-w-xs sm:w-auto">
          <SelectField label="Status" value={filter} onChange={setFilter} options={STATUS_FILTERS} />
        </div>
      </div>

      {listError ? (
        <p role="status" className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          We lost the connection to the attendee list; showing the last values we received and
          retrying.
        </p>
      ) : null}

      {rows === null ? (
        <LoadingState label="Loading attendees…" />
      ) : shown.length === 0 ? (
        <EmptyState title="No attendees" description="No account matches this search." />
      ) : (
        <Panel>
          <ul className="divide-y divide-brand-ink/10">
            {shown.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-brand border px-2 py-1 text-xs font-semibold ${
                        STATUS_CLASSES[row.registrationStatus] ?? STATUS_CLASSES.pending
                      }`}
                    >
                      {row.registrationStatus ?? 'pending'}
                    </span>
                    {row.approvalSource ? (
                      <span className="text-xs text-brand-ink-muted">
                        approved by {row.approvalSource === 'admin' ? 'an organizer' : 'ticket'}
                      </span>
                    ) : null}
                    {row.speakerId ? (
                      <span className="text-xs text-brand-ink-muted">speaker</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-brand-ink">
                    {row.displayName || '(no name yet)'}
                  </p>
                  <p className="text-sm text-brand-ink-muted">{row.email}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {canApprove(row) ? (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => act('approveUser', row.id)}
                      disabled={busyUid === row.id}
                    >
                      Approve
                    </button>
                  ) : null}
                  {canRevoke(row) ? (
                    <DestructiveConfirm
                      trigger="Revoke access"
                      title={`Revoke access for ${row.displayName || row.email}`}
                      confirmLabel="Revoke this person’s access"
                      busyLabel="Revoking…"
                      busy={busyUid === row.id}
                      disabled={busyUid === row.id}
                      consequence="They lose access to the attendee-only pages at once, and their bookmarks and profile stay on the record. Approving them again restores it."
                      onConfirm={() => act('revokeUser', row.id)}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
