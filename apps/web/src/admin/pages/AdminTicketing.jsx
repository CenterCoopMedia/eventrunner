import { TICKET_STATUSES } from 'shared/ticketCommerce';
import { plannerMessage } from '../plannerErrors.js';
import '../plannerFields.css';
// Ticketing tab (issue #31): provider status, CSV import with column
// mapping + dry-run preview, and a searchable ticket list. Two staff
// actions (audit 01 #5): "Sync all tickets" calls ticketingSync, and
// "Create account" on a ticket row calls createUserFromTicket.
//
// `tickets/{externalId}` is server-only (firestore.rules `allow read, write:
// if false` — same reasoning as the other two ticketing collections), so
// every read and write here goes through an admin-gated endpoint rather
// than a live Firestore subscription: getTicketingStatus, ticketingImportCsv,
// ticketingListTickets (functions/src/ticketing/{index,csvImport}.cjs).
//
// FLEXIBLE COLUMN MAPPING (maintainer decision, issue #31): a client's CSV
// export names its own columns, so the browser parses the file and lets the
// admin point our fixed vocabulary (email, id, ...) at whichever header
// holds it, rather than assuming a fixed header shape.
//
// The two tables here are galleys (admin story part 2): hairline rows, a
// sticky head on --admin-rule-strong, fixed column order, data columns in
// the mono with tabular figures, numbers right-aligned. No zebra striping,
// no row cards, no row shadows, no hover lift. Each import verdict is a word
// in a tinted badge at the smallest radius, never a pill (admin story part 5
// refuses that device by name): the word carries the meaning and the tint
// agrees with it.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCsvFile } from '../../lib/csv.js';
import { useAdminApi } from '../adminApi.js';
import AdminIconControl from '../components/AdminIconControl.jsx';
import {
  Notice,
  Panel,
  SelectField,
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
  rowMetaClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';
import AdminTableScroll from '../components/AdminTableScroll.jsx';
import { ticketStatusLabel } from '../../lib/ticketingCommerce.js';
import TicketingConfirmation from '../components/TicketingConfirmation.jsx';
import CreateAccountFromTicket, { canCreateAccountFromTicket } from '../components/CreateAccountFromTicket.jsx';

const StripeTicketingWorkspace = lazy(() => import('../components/StripeTicketingWorkspace.jsx'));

const MAPPING_FIELDS = [
  { id: 'email', label: 'Email address', required: true },
  { id: 'id', label: 'Ticket reference', required: true },
  { id: 'orderId', label: 'Order reference (if different)', required: false },
  { id: 'name', label: 'Full name', required: false },
  { id: 'firstName', label: 'First name (if separate from full name)', required: false },
  { id: 'lastName', label: 'Last name (if separate from full name)', required: false },
  { id: 'ticketClass', label: 'Ticket type', required: false },
  { id: 'status', label: 'Status', required: false },
  { id: 'purchasedAt', label: 'Purchase date', required: false },
];

const PROVIDER_LABELS = { stripe: 'Stripe', eventbrite: 'Eventbrite', manual: 'Manual list', none: 'None' };

function localDateTime(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
}

const VERDICT_LABELS = {
  create: 'New ticket',
  update: 'Update existing',
  duplicate: 'Duplicate in file',
  invalid: 'Invalid',
};
// The badge tone each verdict is set in. The word above is always rendered
// with it, so the tint is the second signal and never the only one.
const VERDICT_TONES = {
  create: 'ok',
  update: 'neutral',
  duplicate: 'caution',
  invalid: 'error',
};

/**
 * A galley table head cell. Both tables here scroll inside their own box, so
 * the head stays sticky and holds the top of that box while the rows move.
 */
function GalleyHead({ children, align = 'start' }) {
  return (
    <th
      scope="col"
      className={`sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs text-admin-xs font-semibold text-admin-ink-secondary ${
        align === 'end' ? 'text-end' : 'text-start'
      }`}
    >
      {children}
    </th>
  );
}

/** "1 new ticket", "3 new tickets". */
function counted(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}

const STOP_SENTENCES = {
  'time-limit': 'The sync stopped at its time limit before it reached every ticket.',
  'page-limit': 'The sync stopped at its page limit before it reached every ticket.',
  'provider-error': 'The sync stopped because the ticketing provider could not be read.',
};

/**
 * The result line for one sync: the running totals of its runs, and what
 * to do next. `progress.result` is the 200 answer of the last run.
 */
function syncResultNotice(progress) {
  const { result, runs } = progress;
  const created = counted(progress.created, 'new ticket', 'new tickets');
  const checked = counted(progress.updated, 'existing ticket', 'existing tickets');
  const skipped = progress.skipped
    ? ` ${counted(progress.skipped, 'record had', 'records had')} no ticket reference and Event Runner skipped ${progress.skipped === 1 ? 'it' : 'them'}.`
    : '';
  if (result.skippedReason === 'read-only-demo') {
    return { tone: 'caution', message: (progress.created || progress.updated)
      ? `This historical demo is read-only. The sync stopped after it saved ${created} and checked ${checked}.`
      : 'This historical demo is read-only. No tickets changed.' };
  }
  if (result.truncated) {
    const stopped = STOP_SENTENCES[result.stoppedReason] || 'The sync stopped before it reached every ticket.';
    const next = result.nextCursor
      ? 'Select Continue sync to go on from where it stopped.'
      : 'Select Sync all tickets to start again from the beginning.';
    return { tone: 'caution', message: `${stopped} So far the sync saved ${created} and checked ${checked}.${skipped} ${next}` };
  }
  const across = runs > 1 ? `Across ${runs} runs it` : 'It';
  return { tone: 'ok', message: `Sync finished. ${across} saved ${created} and checked ${checked}.${skipped}` };
}

/** Words for a failed sync. The upsert is idempotent, so a new run is safe. */
function syncErrorMessage(err) {
  if (err?.code === 'provider-error') return plannerMessage(err.message);
  if (err?.code === 'network' || (err?.status >= 500 && err?.code !== 'config-unavailable')) {
    return 'The sync did not answer. Some tickets may be saved. Run the sync again. It does not make duplicate tickets.';
  }
  return plannerMessage(err?.message ?? 'The sync did not finish. Try again.');
}

/**
 * "Sync all tickets": the recovery tool after missed provider updates.
 * Shown only when the status says the provider supports a full sync.
 */
function SyncAllTickets({ call, providerLabel, onSynced }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [continueError, setContinueError] = useState('');
  // The runs of one sync: totals so far and the last answer. The cursor
  // in that answer lives only here, never in Firestore.
  const [progress, setProgress] = useState(null);
  const busyRef = useRef(false);

  /** A fresh sync sends no cursor. Continue sends the last run's cursor. */
  async function run(cursor) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setContinueError('');
    const fresh = cursor === undefined;
    if (fresh) setProgress(null);
    try {
      const result = await call('ticketingSync', fresh ? {} : { cursor });
      setOpen(false);
      setProgress((prev) => {
        const base = fresh || !prev ? { created: 0, updated: 0, skipped: 0, runs: 0 } : prev;
        return {
          created: base.created + (result.created || 0),
          updated: base.updated + (result.updated || 0),
          skipped: base.skipped + (result.skipped || 0),
          runs: base.runs + 1,
          result,
        };
      });
      onSynced();
    } catch (err) {
      const message = syncErrorMessage(err);
      if (fresh) {
        setError(message);
      } else {
        setContinueError(message);
        // A refused cursor cannot be sent again. The sync starts over.
        if (err?.code === 'bad-cursor') setProgress((prev) => prev && { ...prev, result: { ...prev.result, nextCursor: null } });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const notice = progress ? syncResultNotice(progress) : null;
  const cursor = progress?.result?.truncated ? progress.result.nextCursor : null;

  return (
    <div className="mt-md flex flex-col items-start gap-sm">
      <div className="flex flex-wrap gap-xs">
        <button type="button" className={secondaryButtonClass} onClick={() => { setError(''); setOpen(true); }}>
          Sync all tickets
        </button>
        {cursor ? (
          <button type="button" className={secondaryButtonClass} aria-busy={busy && !open} aria-disabled={busy}
            onClick={() => run(cursor)}>
            {busy && !open ? 'Syncing…' : 'Continue sync'}
          </button>
        ) : null}
      </div>
      {busy && !open ? <AdminLoadingState label="Syncing tickets…" /> : null}
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}
      {continueError ? <Notice tone="error" message={continueError} /> : null}
      {open ? (
        <TicketingConfirmation
          title="Sync all tickets?"
          confirmLabel="Sync all tickets"
          busyLabel="Syncing…"
          busy={busy}
          error={error}
          onClose={() => { setOpen(false); setError(''); }}
          onConfirm={() => run(undefined)}
        >
          <p>Event Runner reads every ticket from {providerLabel} and updates the tickets here. Use this when ticket updates were missed.</p>
          <p>Claimed tickets stay claimed. Refunded and cancelled tickets stay refunded or cancelled.</p>
          <p>The sync starts from the beginning and can take several minutes. Keep this page open until it finishes. If the sync stops before it reaches every ticket, select Continue sync.</p>
          {busy ? <AdminLoadingState label="Syncing tickets…" /> : null}
        </TicketingConfirmation>
      ) : null}
    </div>
  );
}

function StatusCard({ status, error, onRefresh, busy, call }) {
  return (
    <Panel help="Connection and recent ticket updates."
      title="Ticket updates"
      description="Connection and recent ticket updates."
      actions={
        <AdminIconControl className={secondaryButtonClass} onClick={onRefresh} disabled={busy}
          busy={busy} label={busy ? 'Checking…' : 'Refresh'} icon="refresh" />
      }
    >
      {error ? (
        <Notice tone="error" message={error} />
      ) : !status ? (
        <AdminLoadingState label="Loading ticketing status…" />
      ) : (
        <dl className="grid grid-cols-1 gap-sm text-admin-sm sm:grid-cols-2">
          <div>
            <dt className="font-admin-ui text-admin-base font-semibold text-admin-ink">Provider</dt>
            <dd className="font-admin-data text-admin-ink-data">{PROVIDER_LABELS[status.provider] || 'Other'}</dd>
          </div>
          <div>
            <dt className="font-admin-ui text-admin-base font-semibold text-admin-ink">Automatic updates</dt>
            <dd className="text-admin-ink-secondary">
              {status.webhookSupported ? 'Available' : 'Tickets are imported from a file'}
            </dd>
          </div>
          {status.webhookSupported ? (
            <div>
              <dt className="font-admin-ui text-admin-base font-semibold text-admin-ink">Connection</dt>
              <dd className="text-admin-ink-secondary">
                {status.webhookRegisteredAt ? (
                  <span className="font-admin-data text-admin-ink-data">
                    {localDateTime(status.webhookRegisteredAt) ? `Connected on ${localDateTime(status.webhookRegisteredAt)}` : 'Connected'}
                  </span>
                ) : status.provider === 'stripe' ? (
                  'Check ticket updates in your Stripe dashboard.'
                ) : (
                  'Not connected. Contact support to connect ticket updates.'
                )}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="font-admin-ui text-admin-base font-semibold text-admin-ink">Last ticket update</dt>
            <dd className="font-admin-data text-admin-ink-data">{localDateTime(status.lastDeliveryAt) ?? 'None'}</dd>
          </div>
          <div>
            <dt className="font-admin-ui text-admin-base font-semibold text-admin-ink">Updates</dt>
            <dd className="font-admin-data text-admin-ink-data">
              Updates waiting: {status.queue.pending}{status.queue.pendingCapped ? '+' : ''}.
              {' '}Updates that failed: {status.queue.exhausted}{status.queue.exhaustedCapped ? '+' : ''}.
            </dd>
          </div>
        </dl>
      )}
      {status?.fullSyncSupported ? (
        <SyncAllTickets call={call} providerLabel={PROVIDER_LABELS[status.provider] || 'the ticketing provider'} onSynced={onRefresh} />
      ) : null}
    </Panel>
  );
}

function MappingForm({ headers, mapping, onChange }) {
  const options = [{ value: '', label: 'Not in this file' }, ...headers.map((h) => ({ value: h, label: MAPPING_FIELDS.find((field) => field.id === h)?.label || h }))];
  return (
    <div className="planner-fields grid grid-cols-1 gap-sm sm:grid-cols-2">
      {MAPPING_FIELDS.map((field) => (
        <SelectField help="Choose the CSV column that supplies this ticket detail."
          key={field.id}
          label={field.required ? `${field.label} (required)` : field.label}
          value={mapping[field.id] ?? ''}
          onChange={(value) => onChange({ ...mapping, [field.id]: value })}
          options={options}
        />
      ))}
    </div>
  );
}

function PreviewTable({ preview }) {
  const rows = preview.rows.slice(0, 50);
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center gap-xs">
        {Object.entries(preview.summary).map(([verdict, count]) => (
          <StatusBadge key={verdict} tone={VERDICT_TONES[verdict] ?? 'neutral'}>
            {count} {VERDICT_LABELS[verdict] ?? verdict}
          </StatusBadge>
        ))}
      </div>
      <AdminTableScroll className="max-h-[28rem] overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline">
        <table className="w-full min-w-[36rem] border-collapse text-admin-sm">
          <thead>
            <tr>
              <GalleyHead align="end">Row</GalleyHead>
              <GalleyHead>Result</GalleyHead>

              <GalleyHead>Email</GalleyHead>
              <GalleyHead>Reason</GalleyHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.index} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
                <td className="px-sm py-xs text-end font-admin-data text-admin-ink-data">{row.index + 1}</td>
                <td className="px-sm py-xs">
                  <StatusBadge tone={VERDICT_TONES[row.verdict] ?? 'neutral'}>
                    {VERDICT_LABELS[row.verdict] ?? row.verdict}
                  </StatusBadge>
                </td>

                <td className="px-sm py-xs font-admin-data text-admin-ink-data">{row.email ?? '—'}</td>
                <td className="px-sm py-xs text-admin-ink-secondary">{(row.reasons ?? []).join('; ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminTableScroll>
      {preview.rows.length > rows.length ? (
        <p className="text-admin-sm text-admin-ink-secondary">
          Showing the first {rows.length} of {preview.rows.length} rows.
        </p>
      ) : null}
    </div>
  );
}

function ImportPanel({ call, onImported }) {
  const [parsed, setParsed] = useState(null); // { headers, rows, fileName }
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setNotice(null);
    setPreview(null);
    setParsed(null);
    setMapping({});
    try {
      const text = await file.text();
      const { headers, rows } = parseCsvFile(text);
      if (rows.length === 0) {
        setNotice({ kind: 'error', message: 'That file has no data rows.' });
        return;
      }
      setParsed({ headers, rows, fileName: file.name });
      // Best-effort auto-mapping: an exact (case-insensitive) header match
      // saves the obvious case from being mapped by hand.
      const guess = {};
      for (const field of MAPPING_FIELDS) {
        const hit = headers.find((h) => h.toLowerCase() === field.id.toLowerCase() ||
          (field.id === 'email' && /e-?mail/i.test(h)) ||
          (field.id === 'id' && /order.*id|ticket.*id|order.*#/i.test(h)));
        if (hit) guess[field.id] = hit;
      }
      setMapping(guess);
    } catch (err) {
      setNotice({ kind: 'error', message: err instanceof SyntaxError ? err.message : 'That file could not be read as text.' });
    }
  }

  const canPreview = parsed && mapping.email && mapping.id;

  async function runPreview() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await call('ticketingImportCsv', { mapping, rows: parsed.rows, dryRun: true });
      setPreview(result);
    } catch (err) {
      setNotice({ kind: 'error', message: plannerMessage(err?.message ?? 'The preview could not be built.') });
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await call('ticketingImportCsv', { mapping, rows: parsed.rows, dryRun: false });
      setNotice({
        kind: 'ok',
        message: `Imported: ${result.created} new, ${result.updated} updated. ${result.summary.invalid} rows skipped as invalid, ${result.summary.duplicate} as duplicates.`,
      });
      setPreview(result);
      setParsed(null);
      onImported();
    } catch (err) {
      setNotice({ kind: 'error', message: plannerMessage(err?.message ?? 'The import did not finish. Nothing changed. Try again.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel help="Choose a CSV file and match its columns, then review the tickets before importing."
      title="Import tickets from a CSV"
      description="Choose a CSV file and match its columns, then review the tickets before importing."
    >
      <div className="flex flex-col gap-md">
        <div className="flex flex-col gap-3xs">
          <label htmlFor="ticketing-csv-file" className={fieldLabelClass}>
            CSV file
          </label>
          <input data-help-skip="File chooser; the import section describes the CSV and column-matching step."
            id="ticketing-csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={chooseFile}
            className={inputClass}
          />
          {parsed ? (
            <p className={rowMetaClass}>
              {parsed.fileName} · {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>

        {parsed ? (
          <>
            <MappingForm headers={parsed.headers} mapping={mapping} onChange={setMapping} />
            <div className="flex flex-wrap gap-xs">
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={runPreview}
                disabled={!canPreview || busy}
              >
                {busy ? 'Checking…' : 'Preview import'}
              </button>
              {preview ? (
                <button type="button" className={primaryButtonClass} onClick={commit} disabled={busy}>
                  {busy ? 'Importing…' : `Import ${preview.summary.create + preview.summary.update} tickets`}
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {notice ? <Notice tone={notice.kind === 'error' ? 'error' : 'ok'} message={notice.message} /> : null}

        {preview ? <PreviewTable preview={preview} /> : null}
      </div>
    </Panel>
  );
}

function TicketList({ call, refreshToken }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [tickets, setTickets] = useState(null);
  const [cursor, setCursor] = useState(null);
  // The filter that produced the list on screen. Load more pages that list,
  // so it sends this and not the form, which may have been edited since.
  const [applied, setApplied] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [accountResult, setAccountResult] = useState(null);
  const accountResultRef = useRef(null);

  // The row's action goes away once the ticket is claimed, so focus moves
  // to the result line instead of the page body.
  useEffect(() => {
    if (accountResult) accountResultRef.current?.focus();
  }, [accountResult]);

  const onAccountDone = useCallback(({ ticketId, uid, message }) => {
    setTickets((prev) => (prev ?? []).map((t) => (t.id === ticketId ? { ...t, claimedByUid: uid || t.claimedByUid } : t)));
    setAccountResult({ message });
  }, []);

  const search = useCallback(
    async (append = false) => {
      setLoading(true);
      setError(null);
      setAccountResult(null);
      try {
        let filter = applied;
        if (!append) {
          filter = {};
          if (email.trim()) filter.email = email.trim();
          if (status) filter.status = status;
        }
        const body = append && cursor ? { ...filter, cursor } : filter;
        const result = await call('ticketingListTickets', body);
        setTickets((prev) => (append ? [...(prev ?? []), ...result.tickets] : result.tickets));
        setCursor(result.nextCursor);
        setApplied(filter);
      } catch (err) {
        setError(plannerMessage(err?.message ?? 'The ticket list could not be loaded.'));
      } finally {
        setLoading(false);
      }
    },
    [call, email, status, cursor, applied],
  );

  useEffect(() => {
    search(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshToken is a deliberate re-fetch trigger, not a dependency of `search` itself
  }, [refreshToken]);

  return (
    <Panel help="Find tickets by email address and status." title="Tickets" description="Find tickets by email address and status.">
      <form
        className="mb-md flex flex-wrap items-end gap-sm"
        onSubmit={(event) => {
          event.preventDefault();
          setCursor(null);
          search(false);
        }}
      >
        <div className="flex flex-col gap-3xs">
          <label htmlFor="ticketing-search-email" className={fieldLabelClass}>
            Email
          </label>
          <input data-help-skip="Search field; its label names the email search."
            id="ticketing-search-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="attendee@example.com"
          />
        </div>
        <SelectField help="Choose which records to show in this list."
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'Any' },
            ...TICKET_STATUSES.map((value) => ({ value, label: ticketStatusLabel(value) })),
          ]}
        />
        <button type="submit" className={secondaryButtonClass} disabled={loading}>
          Search
        </button>
      </form>

      {error ? <Notice tone="error" message={error} /> : null}
      {accountResult ? (
        <div ref={accountResultRef} tabIndex={-1} className="mb-sm">
          <Notice tone="ok" message={accountResult.message} />
        </div>
      ) : null}

      {tickets === null ? (
        <AdminLoadingState label="Loading tickets…" />
      ) : tickets.length === 0 ? (
        <AdminEmptyState title="No tickets found" description="Import a CSV above, or adjust your search." />
      ) : (
        <AdminTableScroll className="max-h-[28rem] overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline">
          <table className="w-full min-w-[40rem] border-collapse text-admin-sm">
            <thead>
              <tr>
                <GalleyHead>Email</GalleyHead>
                <GalleyHead>Name</GalleyHead>
                <GalleyHead>Status</GalleyHead>
                <GalleyHead>Claimed</GalleyHead>
                <GalleyHead>Account</GalleyHead>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
                  <td className="px-sm py-xs font-admin-data text-admin-ink-data">{t.email ?? '—'}</td>
                  <td className="px-sm py-xs text-admin-ink-secondary">
                    {[t.firstName, t.lastName].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-sm py-xs font-admin-data text-admin-ink-data">{t.status ? ticketStatusLabel(t.status) : '—'}</td>
                  <td className="px-sm py-xs text-admin-ink-secondary">{t.claimedByUid ? 'Yes' : 'No'}</td>
                  <td className="px-sm py-xs text-admin-ink-secondary">
                    {canCreateAccountFromTicket(t) ? (
                      <CreateAccountFromTicket call={call} ticket={t} ticketId={t.id} onDone={onAccountDone} />
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableScroll>
      )}

      {cursor ? (
        <div className="mt-sm">
          <button type="button" className={secondaryButtonClass} onClick={() => search(true)} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

export default function AdminTicketing() {
  const call = useAdminApi();
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const refreshStatus = useCallback(async () => {
    setStatusBusy(true);
    setStatusError(null);
    try {
      setStatus(await call('getTicketingStatus', {}));
    } catch (err) {
      setStatusError(plannerMessage(err?.message ?? 'The ticketing status could not be loaded.'));
    } finally {
      setStatusBusy(false);
    }
  }, [call]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const onImported = useMemo(() => () => setRefreshToken((n) => n + 1), []);
  const confirmedProvider = !statusBusy && statusError === null ? status?.provider : null;

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader help="Manage ticket sales, registration records, and attendee admission."
        title="Ticketing"
        description="Manage ticket sales, registration records, and attendee admission."
      />

      <StatusCard status={status} error={statusError} onRefresh={refreshStatus} busy={statusBusy} call={call} />
      {confirmedProvider === 'stripe' ? <Suspense fallback={<AdminLoadingState label="Loading Stripe ticketing…" />}>
        <StripeTicketingWorkspace call={call} />
      </Suspense> : ['eventbrite', 'manual', 'none'].includes(confirmedProvider) ? <>
        <ImportPanel call={call} onImported={onImported} />
        <TicketList call={call} refreshToken={refreshToken} />
      </> : null}
    </div>
  );
}
