// Ticketing tab (issue #31): provider status, CSV import with column
// mapping + dry-run preview, and a searchable ticket list.
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
// no row cards, no row shadows, no hover lift. The import verdicts read as
// plain words in the data face — never a coloured pill (admin story part 5
// refuses that device by name).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseCsvFile } from '../../lib/csv.js';
import { useAdminApi } from '../adminApi.js';
import {
  Notice,
  Panel,
  SelectField,
  primaryButtonClass,
  secondaryButtonClass,
  inputClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { AdminEmptyState, AdminLoadingState } from '../components/adminChrome.jsx';

const MAPPING_FIELDS = [
  { id: 'email', label: 'Email address', required: true },
  { id: 'id', label: 'Order / ticket ID', required: true },
  { id: 'orderId', label: 'Order ID (if different from the ticket ID above)', required: false },
  { id: 'name', label: 'Full name', required: false },
  { id: 'firstName', label: 'First name (if separate from full name)', required: false },
  { id: 'lastName', label: 'Last name (if separate from full name)', required: false },
  { id: 'ticketClass', label: 'Ticket type', required: false },
  { id: 'status', label: 'Status', required: false },
  { id: 'purchasedAt', label: 'Purchase date', required: false },
];

const VERDICT_LABELS = {
  create: 'New ticket',
  update: 'Update existing',
  duplicate: 'Duplicate in file',
  invalid: 'Invalid',
};
// The verdict's word, in the data face ink that matches its meaning. No
// border, no fill, no rounded chip — the word carries it, the colour never
// carries it alone.
const VERDICT_INK = {
  create: 'text-admin-state-ok',
  update: 'text-admin-ink-data',
  duplicate: 'text-admin-state-caution',
  invalid: 'text-admin-state-error',
};

/** A galley table head cell: sticky, on the strong rule, in the UI face. */
function GalleyHead({ children, align = 'start' }) {
  return (
    <th
      scope="col"
      className={`sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-raised px-sm py-2xs font-admin-ui font-semibold text-admin-ink ${
        align === 'end' ? 'text-end' : 'text-start'
      }`}
    >
      {children}
    </th>
  );
}

function StatusCard({ status, error, onRefresh, busy }) {
  return (
    <Panel
      title="Provider status"
      description="What the ticketing core (§3.3) currently reports."
      actions={
        <button type="button" className={secondaryButtonClass} onClick={onRefresh} disabled={busy}>
          {busy ? 'Checking…' : 'Refresh'}
        </button>
      }
    >
      {error ? (
        <Notice tone="error" message={error} />
      ) : !status ? (
        <AdminLoadingState label="Loading ticketing status…" />
      ) : (
        <dl className="grid grid-cols-1 gap-sm text-caption sm:grid-cols-2">
          <div>
            <dt className="font-admin-ui font-semibold text-admin-ink">Provider</dt>
            <dd className="font-admin-data text-admin-ink-data">{status.provider}</dd>
          </div>
          <div>
            <dt className="font-admin-ui font-semibold text-admin-ink">Webhook support</dt>
            <dd className="text-admin-ink-secondary">
              {status.webhookSupported ? 'Supported' : 'Not applicable for this provider'}
            </dd>
          </div>
          {status.webhookSupported ? (
            <div>
              <dt className="font-admin-ui font-semibold text-admin-ink">Webhook registration</dt>
              <dd className="text-admin-ink-secondary">
                {status.webhookRegisteredAt ? (
                  <span className="font-admin-data text-admin-ink-data">
                    Registered {status.webhookRegisteredAt}
                    {status.webhookId ? ` (id ${status.webhookId})` : ''}
                  </span>
                ) : (
                  <>
                    Not registered —{' '}
                    <code className="rounded-admin bg-admin-ground-input px-2xs py-3xs font-admin-data text-folio text-admin-ink-data">
                      node scripts/register-ticketing-webhook.cjs
                    </code>
                  </>
                )}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="font-admin-ui font-semibold text-admin-ink">Last webhook delivery</dt>
            <dd className="font-admin-data text-admin-ink-data">{status.lastDeliveryAt ?? 'None'}</dd>
          </div>
          <div>
            <dt className="font-admin-ui font-semibold text-admin-ink">Sync queue</dt>
            <dd className="font-admin-data text-admin-ink-data">
              {status.queue.pending} pending{status.queue.pendingCapped ? '+' : ''}
              {', '}
              {status.queue.exhausted} exhausted{status.queue.exhaustedCapped ? '+' : ''}
            </dd>
          </div>
        </dl>
      )}
    </Panel>
  );
}

function MappingForm({ headers, mapping, onChange }) {
  const options = [{ value: '', label: '— not in this file —' }, ...headers.map((h) => ({ value: h, label: h }))];
  return (
    <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
      {MAPPING_FIELDS.map((field) => (
        <SelectField
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
      <div className="flex flex-wrap gap-x-sm gap-y-3xs font-admin-data text-caption">
        {Object.entries(preview.summary).map(([verdict, count]) => (
          <span key={verdict} className={VERDICT_INK[verdict] ?? 'text-admin-ink-data'}>
            {count} {VERDICT_LABELS[verdict] ?? verdict}
          </span>
        ))}
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline">
        <table className="w-full min-w-[36rem] border-collapse text-caption">
          <thead>
            <tr>
              <GalleyHead align="end">Row</GalleyHead>
              <GalleyHead>Result</GalleyHead>
              <GalleyHead>Ticket ID</GalleyHead>
              <GalleyHead>Email</GalleyHead>
              <GalleyHead>Reason</GalleyHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.index} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
                <td className="px-sm py-2xs text-end font-admin-data text-admin-ink-data">{row.index + 1}</td>
                <td className={`px-sm py-2xs font-admin-data ${VERDICT_INK[row.verdict] ?? 'text-admin-ink-data'}`}>
                  {VERDICT_LABELS[row.verdict] ?? row.verdict}
                </td>
                <td className="px-sm py-2xs font-admin-data text-admin-ink-data">{row.externalId ?? '—'}</td>
                <td className="px-sm py-2xs font-admin-data text-admin-ink-data">{row.email ?? '—'}</td>
                <td className="px-sm py-2xs text-admin-ink-secondary">{(row.reasons ?? []).join('; ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.rows.length > rows.length ? (
        <p className="text-caption text-admin-ink-secondary">
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
    } catch {
      setNotice({ kind: 'error', message: 'That file could not be read as text.' });
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
      setNotice({ kind: 'error', message: err?.message ?? 'The preview could not be built.' });
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
      setNotice({ kind: 'error', message: err?.message ?? 'The import could not be committed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Import tickets from a CSV"
      description="Upload a file, map its columns onto email + order/ticket id (required), preview what would happen, then commit."
    >
      <div className="flex flex-col gap-md">
        <div className="flex flex-col gap-3xs">
          <label htmlFor="ticketing-csv-file" className="text-caption font-semibold text-admin-ink">
            CSV file
          </label>
          <input
            id="ticketing-csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={chooseFile}
            className={inputClass}
          />
          {parsed ? (
            <p className="font-admin-data text-folio text-admin-ink-data">
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
                  {busy ? 'Importing…' : `Commit ${preview.summary.create + preview.summary.update} tickets`}
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const search = useCallback(
    async (append = false) => {
      setLoading(true);
      setError(null);
      try {
        const body = {};
        if (email.trim()) body.email = email.trim();
        if (status) body.status = status;
        if (append && cursor) body.cursor = cursor;
        const result = await call('ticketingListTickets', body);
        setTickets((prev) => (append ? [...(prev ?? []), ...result.tickets] : result.tickets));
        setCursor(result.nextCursor);
      } catch (err) {
        setError(err?.message ?? 'The ticket list could not be loaded.');
      } finally {
        setLoading(false);
      }
    },
    [call, email, status, cursor],
  );

  useEffect(() => {
    search(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshToken is a deliberate re-fetch trigger, not a dependency of `search` itself
  }, [refreshToken]);

  return (
    <Panel title="Tickets" description="Exact-match search over the imported and synced ticket set.">
      <form
        className="mb-md flex flex-wrap items-end gap-sm"
        onSubmit={(event) => {
          event.preventDefault();
          setCursor(null);
          search(false);
        }}
      >
        <div className="flex flex-col gap-3xs">
          <label htmlFor="ticketing-search-email" className="text-caption font-semibold text-admin-ink">
            Email
          </label>
          <input
            id="ticketing-search-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="attendee@example.com"
          />
        </div>
        <SelectField
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'Any' },
            { value: 'valid', label: 'Valid' },
            { value: 'refunded', label: 'Refunded' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'pending_info', label: 'Pending info' },
          ]}
        />
        <button type="submit" className={secondaryButtonClass} disabled={loading}>
          Search
        </button>
      </form>

      {error ? <Notice tone="error" message={error} /> : null}

      {tickets === null ? (
        <AdminLoadingState label="Loading tickets…" />
      ) : tickets.length === 0 ? (
        <AdminEmptyState title="No tickets found" description="Import a CSV above, or adjust your search." />
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline">
          <table className="w-full min-w-[40rem] border-collapse text-caption">
            <thead>
              <tr>
                <GalleyHead>Ticket ID</GalleyHead>
                <GalleyHead>Email</GalleyHead>
                <GalleyHead>Name</GalleyHead>
                <GalleyHead>Status</GalleyHead>
                <GalleyHead>Claimed</GalleyHead>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
                  <td className="px-sm py-2xs font-admin-data text-admin-ink-data">{t.id}</td>
                  <td className="px-sm py-2xs font-admin-data text-admin-ink-data">{t.email ?? '—'}</td>
                  <td className="px-sm py-2xs text-admin-ink-secondary">
                    {[t.firstName, t.lastName].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-sm py-2xs font-admin-data text-admin-ink-data">{t.status ?? '—'}</td>
                  <td className="px-sm py-2xs text-admin-ink-secondary">{t.claimedByUid ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      setStatusError(err?.message ?? 'The ticketing status could not be loaded.');
    } finally {
      setStatusBusy(false);
    }
  }, [call]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const onImported = useMemo(() => () => setRefreshToken((n) => n + 1), []);

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Ticketing"
        description="Provider status, CSV import for the manual/no-vendor path (spec §3.3), and the ticket list."
      />

      <StatusCard status={status} error={statusError} onRefresh={refreshStatus} busy={statusBusy} />
      <ImportPanel call={call} onImported={onImported} />
      <TicketList call={call} refreshToken={refreshToken} />
    </div>
  );
}
