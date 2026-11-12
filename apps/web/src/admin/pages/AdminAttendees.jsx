import { plannerMessage } from '../plannerErrors.js';
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
//   revoked   → Approve; Revoke access also appears after ticket access ended
//               so an organizer can prevent a later ticket from restoring it.
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
//
// Export (issue #184): the title band's one action saves the rows on screen
// as a CSV file. The page sends the uids it shows, in the order it shows
// them, plus the status filter and whether a search narrowed the list —
// never the search text, which can name a person and would outlive them in
// the audit row. The server re-reads each account, writes the admin_logs
// row, and only then returns the file (functions/src/users/export.cjs).
//
// The organizer record (issue #185): "Edit record" on a row opens its
// AttendeeRecordPanel, one at a time — the organizer-owned past attendance
// list and the account delete. A deleted row leaves through the listener,
// often before the call answers, so a delete's result is stated HERE, at
// page level: a success line that takes focus, or an error notice that
// keeps the uid and offers "Try the delete again" until a retry succeeds.
// Only a refusal made before anything was deleted, for a row still listed,
// goes back to that row's panel (refusedBeforeDelete). Every other failure
// — delete-incomplete, a gateway timeout, a dropped connection — may have
// come after the directory commit, and the retry resumes it.
import { Link } from 'react-router';
import AdminIconControl from '../components/AdminIconControl.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import { saveTextFile } from '../downloadFile.js';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  SaveStatus,
  SelectField,
  TextField,
  rowMetaClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import { activeQuestions } from 'shared/registrationForm';
import { subscribeRegistrationForm } from '../../lib/registrationFormSource.js';
import { RegistrationSummary } from '../components/RegistrationAnswers.jsx';
import AttendeeRecordPanel, {
  AttendeeRecordToggle,
  refusedBeforeDelete,
} from '../components/AttendeeRecordPanel.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  StatusBadge,
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
 * The account's registration status, as a word in a badge whose tint agrees
 * with it — never colour alone (§8.1). `revoked` is dead matter and keeps
 * its word on the standing-matter ink; every other status renders in the
 * neutral tone, because none of them is this admin's Draft/Live vocabulary.
 */
function registrationState(status, reason) {
  if (status === 'revoked') return deadMatter(reason === 'entitlement_lost' ? 'Ticket access ended' : REGISTRATION_LABELS.revoked);
  return { id: status ?? 'pending', label: REGISTRATION_LABELS[status] ?? status ?? 'Pending' };
}

/** Rows an organizer can act on, per the §3.4 table. */
function canApprove(row) {
  if (row.registrationStatus === 'approved') return row.approvalSource !== 'admin';
  return ['pending', 'ticketed', 'revoked'].includes(row.registrationStatus);
}

function canRevoke(row) {
  return ['ticketed', 'approved'].includes(row.registrationStatus) ||
    (row.registrationStatus === 'revoked' && row.revocationReason === 'entitlement_lost');
}

/** "1 attendee", "42 attendees". */
function attendeeCount(count) {
  return `${count} attendee${count === 1 ? '' : 's'}`;
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
  // The latest listener delivery, for a delete result that arrives after it.
  const rowsRef = useRef(null);
  const [listError, setListError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busyUid, setBusyUid] = useState(null);
  const [removingBadges, setRemovingBadges] = useState([]);
  const [badgeRemovalResult, setBadgeRemovalResult] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  // A second press in the same tick, before the disabled state renders,
  // must not start a second export: each one writes an audit row.
  const exportingRef = useRef(false);
  const [openUid, setOpenUid] = useState(null);
  // { tone: 'ok', message } after a delete, or { tone: 'incomplete', uid,
  // name, message } while an account is out of the directory with data
  // still to clear. It outlives the row, which the listener removes.
  const [deleteResult, setDeleteResult] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const deleteResultRef = useRef(null);
  // { uid, error }: a refusal made before anything was deleted, shown in
  // that row's panel while the row is still listed.
  const [rowDeleteError, setRowDeleteError] = useState(null);

  useEffect(() => {
    if (deleteResult) deleteResultRef.current?.focus();
  }, [deleteResult]);

  // Registration answers (ADR 0008 §4), for the summary and each record.
  const [answerRecords, setAnswerRecords] = useState([]);
  const [registrationForm, setRegistrationForm] = useState(null);
  useEffect(() => subscribeAdminCollection('ticket_answers', setAnswerRecords), []);
  useEffect(() => subscribeRegistrationForm(setRegistrationForm), []);
  const answersByUid = useMemo(() => {
    const map = new Map();
    for (const record of answerRecords) {
      if (!record.uid) continue;
      map.set(record.uid, [...(map.get(record.uid) ?? []), record].sort((a, b) => a.id.localeCompare(b.id)));
    }
    return map;
  }, [answerRecords]);
  const asksQuestions = activeQuestions(registrationForm).length > 0;

  useEffect(() => {
    return subscribeAdminCollection(
      'users',
      (docs) => { rowsRef.current = docs; setRows(docs); setListError(null); },
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
          : REGISTRATION_LABELS[result?.registrationStatus]
            ? `Registration set to ${REGISTRATION_LABELS[result.registrationStatus].toLowerCase()}.`
            : 'Registration updated.',
      );
    } catch (err) {
      showToast(plannerMessage(err.message), { tone: 'error' });
    } finally {
      setBusyUid(null);
    }
  }

  async function exportShown() {
    if (exportingRef.current || shown.length === 0) return;
    exportingRef.current = true;
    setExporting(true);
    setExportResult(null);
    try {
      const result = await call('exportAttendees', {
        uids: shown.map((row) => row.id),
        filter: { status: filter, searched: search.trim() !== '' },
      });
      saveTextFile(result.filename, result.csv);
      setExportResult({
        tone: 'ok',
        message: `Exported ${attendeeCount(result.rowCount)} to ${result.filename}.`,
      });
    } catch (err) {
      setExportResult({ tone: 'error', message: plannerMessage(err.message) });
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  function deleted({ name }) {
    setOpenUid(null);
    setRowDeleteError(null);
    setDeleteResult({ tone: 'ok', message: `Deleted the account for ${name}.` });
  }

  function deleteUnfinished({ uid, name, error }) {
    setOpenUid(null);
    setRowDeleteError(null);
    setDeleteResult({
      tone: 'incomplete',
      uid,
      name,
      // The server's own words when it says what happened; otherwise the
      // call's own failure, with what it may mean.
      message: error?.code === 'delete-incomplete'
        ? error.message
        : `The delete may not have finished. ${error?.message ?? ''}`.trim(),
    });
  }

  function deleteStarted(uid) {
    setRowDeleteError((current) => (current?.uid === uid ? null : current));
  }

  function deleteFailed({ uid, name, error }) {
    // A 404 means nothing of the account remains.
    if (error?.status === 404) {
      deleted({ name });
      return;
    }
    const stillListed = (rowsRef.current ?? []).some((listed) => listed.id === uid);
    if (refusedBeforeDelete(error) && stillListed) {
      setOpenUid(uid);
      setRowDeleteError({ uid, error });
      return;
    }
    deleteUnfinished({ uid, name, error });
  }

  async function retryDelete() {
    if (deleteResult?.tone !== 'incomplete' || retrying) return;
    const { uid, name } = deleteResult;
    setRetrying(true);
    try {
      await call('deleteAttendee', { uid });
      deleted({ name });
    } catch (err) {
      // A 404 on a retry means nothing of the account remains: the earlier
      // call finished the work after all.
      if (err?.status === 404) deleted({ name });
      else deleteUnfinished({ uid, name, error: err });
    } finally {
      setRetrying(false);
    }
  }

  async function removeCustomBadge(uid, badge) {
    const pendingKey = `${uid}:${badge}`;
    setRemovingBadges((current) => [...current, pendingKey]);
    setBadgeRemovalResult(null);
    try {
      await call('removeUserCustomBadge', { uid, badge });
      setBadgeRemovalResult({ uid, tone: 'ok', message: `“${badge}” was removed.` });
      showToast('Custom badge removed.');
    } catch (err) {
      setBadgeRemovalResult({ uid, tone: 'error', message: plannerMessage(err.message) });
      showToast(plannerMessage(err.message), { tone: 'error' });
    } finally {
      setRemovingBadges((current) => current.filter((key) => key !== pendingKey));
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader help="Manage attendance and access. Organizer approvals stay in place after refunds. Downloads include private registration answers; keep these files secure."
        title="Attendees"
        identifiers={rows ? `${shown.length} of ${rows.length} account${rows.length === 1 ? '' : 's'}` : undefined}
        description="Manage attendance and access. Organizer approvals stay in place after refunds. Downloads include private registration answers; keep these files secure."
        actions={
          rows === null ? null : (
            <AdminIconControl
              label={`Download ${attendeeCount(shown.length)}`}
              icon="download"
              busy={exporting}
              className={secondaryButtonClass}
              onClick={exportShown}
              disabled={exporting || shown.length === 0}
              aria-busy={exporting ? 'true' : undefined}
            />
          )
        }
      />

      {asksQuestions ? <RegistrationSummary form={registrationForm} records={answerRecords} /> : null}

      {exportResult?.tone === 'ok' ? <SaveStatus message={exportResult.message} /> : null}
      {exportResult?.tone === 'error' ? <Notice tone="error" message={exportResult.message} /> : null}

      {deleteResult?.tone === 'ok' ? (
        <p
          ref={deleteResultRef}
          tabIndex={-1}
          role="status"
          className="text-admin-sm text-admin-ink-secondary"
        >
          {deleteResult.message}
        </p>
      ) : null}
      {deleteResult?.tone === 'incomplete' ? (
        <div ref={deleteResultRef} tabIndex={-1} className="flex flex-col items-start gap-xs">
          <Notice tone="error" message={`${deleteResult.name}: ${deleteResult.message}`} />
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={retryDelete}
            disabled={retrying}
            aria-busy={retrying ? 'true' : undefined}
          >
            {retrying ? 'Deleting…' : 'Try the delete again'}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-sm">
        <div className="min-w-0 flex-1">
          <TextField data-help-skip="The label directly names the requested detail; no further explanation needed."
            label="Search"
            value={search}
            onChange={setSearch}
            type="search"
            placeholder="Name, email, or organization"
          />
        </div>
        <div className="w-full max-w-xs sm:w-auto">
          <SelectField help="Choose which records to show in this list." label="Status" value={filter} onChange={setFilter} options={STATUS_FILTERS} />
        </div>
      </div>

      {listError ? (
        <Notice
          tone="caution"
          message="The list did not refresh. Trying again…"
        />
      ) : null}

      {rows === null ? (
        <AdminLoadingState label="Loading attendees…" />
      ) : shown.length === 0 ? (
        <AdminEmptyState title={rows.length ? "No matching attendees" : "No attendees yet"} description={rows.length ? "Clear the filters to see all attendees." : "Import a registration list to add attendees."} action={rows.length ? <button type="button" className={secondaryButtonClass} onClick={() => { setFilter('all'); setSearch(''); }}>Clear filters</button> : <Link to="/admin/import" className={secondaryButtonClass}>Import attendees</Link>} />
      ) : (
        <Panel flush>
          <ul>
            {shown.map((row) => (
              <li
                key={row.id}
                className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-sm px-md py-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                      <span className="text-admin-base font-bold text-admin-ink">
                        {row.displayName || 'No name yet'}
                      </span>
                      <RecordState state={registrationState(row.registrationStatus, row.revocationReason)} />
                      {row.registrationStatus === 'revoked' && row.revocationReason === 'entitlement_lost' ? (
                        <span className="text-admin-xs text-admin-ink-secondary">
                          A valid ticket restores ticket access. Revoke access to keep this account blocked.
                        </span>
                      ) : null}
                      {row.approvalSource ? (
                        <span className="text-admin-xs text-admin-ink-secondary">
                          approved by {row.approvalSource === 'admin' ? 'an organizer' : 'ticket'}
                        </span>
                      ) : null}
                      {row.speakerId ? <StatusBadge tone="info">Speaker</StatusBadge> : null}
                    </div>
                    <p className={`mt-3xs break-all ${rowMetaClass}`}>{row.email}</p>
                    {Array.isArray(row.pastAttendance) && row.pastAttendance.length > 0 ? (
                      <p className={`mt-3xs ${rowMetaClass}`}>
                        Past attendance: {row.pastAttendance.filter((entry) => typeof entry === 'string').join('; ')}
                      </p>
                    ) : null}
                    {Array.isArray(row.customBadges) && row.customBadges.length > 0 ? (
                      <div className="mt-xs">
                        <p className={rowMetaClass}>Custom badges</p>
                        <ul className="mt-2xs flex flex-wrap gap-xs">
                          {row.customBadges.map((badge, index) => {
                            if (typeof badge !== 'string' || !badge.trim()) return null;
                            const pendingKey = `${row.id}:${badge}`;
                            return (
                              <li key={`${badge}-${index}`} className="flex items-center gap-2xs">
                                <StatusBadge>{badge}</StatusBadge>
                                <DestructiveConfirm
                                  trigger={`Remove “${badge}”`}
                                  triggerIcon="remove"
                                  title={`Remove “${badge}”`}
                                  confirmLabel={`Remove “${badge}”`}
                                  busyLabel="Removing…"
                                  busy={removingBadges.includes(pendingKey)}
                                  disabled={removingBadges.includes(pendingKey)}
                                  consequence="This custom badge disappears from the attendee’s profile."
                                  onConfirm={() => removeCustomBadge(row.id, badge)}
                                />
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                    {badgeRemovalResult?.uid === row.id ? (
                      <div className="mt-xs">
                        <Notice
                          tone={badgeRemovalResult.tone}
                          message={badgeRemovalResult.message}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-xs">
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
                        consequence="They lose access to the attendee-only pages. A new ticket will not restore access. Their bookmarks and profile stay on the record. Approving them again restores access."
                        onConfirm={() => act('revokeUser', row.id)}
                      />
                    ) : null}
                    <AttendeeRecordToggle
                      uid={row.id}
                      open={openUid === row.id}
                      onToggle={() => {
                        setRowDeleteError(null);
                        setOpenUid((current) => (current === row.id ? null : row.id));
                      }}
                    />
                  </div>
                </div>
                {openUid === row.id ? (
                  <AttendeeRecordPanel
                    row={row}
                    registrationForm={registrationForm}
                    answers={answersByUid.get(row.id) ?? []}
                    deleteError={rowDeleteError?.uid === row.id ? rowDeleteError.error : null}
                    onDeleteStart={deleteStarted}
                    onDeleted={deleted}
                    onDeleteFailed={deleteFailed}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
