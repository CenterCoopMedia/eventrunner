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
//
// Restyled onto the fixed admin identity (docs/plans/2026-08-27-admin-
// identity-story.md). This is the galley: hairline rows on Panel, no zebra,
// no row cards. Registration status is a different axis from the admin's
// Draft/Live/dirty publish vocabulary (recordState.js) — a user account is
// never a two-revision CMS record — so it keeps its own words, the same way
// AdminSpeakersList keeps its invite-pipeline PIPELINE_LABELS apart from the
// record state. A revoked account is dead matter: it keeps its word and
// drops to the standing-matter ink (moment 1's device reused for the one
// axis this surface actually has).
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  SelectField,
  TextField,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';
import { deadMatter } from '../recordState.js';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'ticketed', label: 'Ticketed' },
  { value: 'approved', label: 'Approved' },
  { value: 'revoked', label: 'Revoked' },
];

const REGISTRATION_LABELS = {
  pending: 'Pending',
  ticketed: 'Ticketed',
  approved: 'Approved',
  revoked: 'Revoked',
};

/**
 * The account's registration status, as a word in the data face — never a
 * coloured pill (§8.1). `revoked` is dead matter and keeps its word on the
 * standing-matter ink; every other status renders on the secondary ink,
 * because none of them is this admin's Draft/Live vocabulary.
 */
function registrationState(status) {
  if (status === 'revoked') return deadMatter(REGISTRATION_LABELS.revoked);
  return { id: status ?? 'pending', label: REGISTRATION_LABELS[status] ?? status ?? 'Pending' };
}

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
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Attendees"
        identifiers={rows ? `${shown.length} of ${rows.length} account${rows.length === 1 ? '' : 's'}` : undefined}
        description="Registration status for every account. An approval you make here is recorded as an organizer decision and survives a ticket refund; a revocation is never undone by a later ticket sync."
      />

      <div className="flex flex-wrap items-end gap-sm">
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
        <Notice
          tone="caution"
          message="We lost the connection to the attendee list; showing the last values we received and retrying."
        />
      ) : null}

      {rows === null ? (
        <AdminLoadingState label="Loading attendees…" />
      ) : shown.length === 0 ? (
        <AdminEmptyState title="No attendees" description="No account matches this search." />
      ) : (
        <Panel flush>
          <ul>
            {shown.map((row) => (
              <li
                key={row.id}
                className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-sm px-md py-xs">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-sm gap-y-3xs">
                      <span className="font-semibold text-admin-ink">
                        {row.displayName || '(no name yet)'}
                      </span>
                      <RecordState state={registrationState(row.registrationStatus)} />
                      {row.approvalSource ? (
                        <span className="text-folio text-admin-ink-secondary">
                          approved by {row.approvalSource === 'admin' ? 'an organizer' : 'ticket'}
                        </span>
                      ) : null}
                      {row.speakerId ? (
                        <span className="font-admin-data text-folio text-admin-ink-secondary">
                          Speaker
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3xs truncate font-admin-data text-folio text-admin-ink-data">
                      {row.email}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-xs">
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
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
