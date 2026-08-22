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
import { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { parseCsvFile } from '../../lib/csv.js';
import { useAdminApi } from '../adminApi.js';
import { Panel, SelectField, primaryButtonClass, secondaryButtonClass, inputClass } from '../components/formControls.jsx';

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
const VERDICT_CLASSES = {
  create: 'border-success/40 bg-success/10 text-success',
  update: 'border-brand-ink/20 bg-brand-surface-alt text-brand-ink',
  duplicate: 'border-warning/40 bg-warning/10 text-warning',
  invalid: 'border-danger/40 bg-danger/10 text-danger',
};

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
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : !status ? (
        <LoadingState label="Loading ticketing status…" />
      ) : (
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-brand-ink">Provider</dt>
            <dd className="text-brand-ink-muted">{status.provider}</dd>
          </div>
          <div>
            <dt className="font-semibold text-brand-ink">Webhook support</dt>
            <dd className="text-brand-ink-muted">
              {status.webhookSupported ? 'Supported' : 'Not applicable for this provider'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-brand-ink">Last webhook delivery</dt>
            <dd className="text-brand-ink-muted">{status.lastDeliveryAt ?? 'None'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-brand-ink">Sync queue</dt>
            <dd className="text-brand-ink-muted">
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3 text-sm">
        {Object.entries(preview.summary).map(([verdict, count]) => (
          <span
            key={verdict}
            className={`rounded-brand border px-2 py-1 font-semibold ${VERDICT_CLASSES[verdict] ?? ''}`}
          >
            {count} {VERDICT_LABELS[verdict] ?? verdict}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto rounded-brand border border-brand-ink/10">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-brand-surface-alt">
            <tr>
              <th className="px-3 py-2 font-semibold text-brand-ink">Row</th>
              <th className="px-3 py-2 font-semibold text-brand-ink">Result</th>
              <th className="px-3 py-2 font-semibold text-brand-ink">Ticket ID</th>
              <th className="px-3 py-2 font-semibold text-brand-ink">Email</th>
              <th className="px-3 py-2 font-semibold text-brand-ink">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-ink/10">
            {rows.map((row) => (
              <tr key={row.index}>
                <td className="px-3 py-2 text-brand-ink-muted">{row.index + 1}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-brand border px-2 py-0.5 text-xs font-semibold ${VERDICT_CLASSES[row.verdict] ?? ''}`}
                  >
                    {VERDICT_LABELS[row.verdict] ?? row.verdict}
                  </span>
                </td>
                <td className="px-3 py-2 text-brand-ink">{row.externalId ?? '—'}</td>
                <td className="px-3 py-2 text-brand-ink-muted">{row.email ?? '—'}</td>
                <td className="px-3 py-2 text-brand-ink-muted">{(row.reasons ?? []).join('; ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.rows.length > rows.length ? (
        <p className="text-sm text-brand-ink-muted">
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
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="ticketing-csv-file" className="text-sm font-semibold text-brand-ink">
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
            <p className="text-sm text-brand-ink-muted">
              {parsed.fileName} · {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>

        {parsed ? (
          <>
            <MappingForm headers={parsed.headers} mapping={mapping} onChange={setMapping} />
            <div className="flex flex-wrap gap-3">
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

        {notice ? (
          <p
            role="alert"
            className={`rounded-brand border px-3 py-2 text-sm ${
              notice.kind === 'error'
                ? 'border-danger/40 bg-danger/10 text-danger'
                : 'border-success/40 bg-success/10 text-success'
            }`}
          >
            {notice.message}
          </p>
        ) : null}

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
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setCursor(null);
          search(false);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="ticketing-search-email" className="text-sm font-semibold text-brand-ink">
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

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {tickets === null ? (
        <LoadingState label="Loading tickets…" />
      ) : tickets.length === 0 ? (
        <EmptyState title="No tickets found" description="Import a CSV above, or adjust your search." />
      ) : (
        <div className="overflow-x-auto rounded-brand border border-brand-ink/10">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-brand-surface-alt">
              <tr>
                <th className="px-3 py-2 font-semibold text-brand-ink">Ticket ID</th>
                <th className="px-3 py-2 font-semibold text-brand-ink">Email</th>
                <th className="px-3 py-2 font-semibold text-brand-ink">Name</th>
                <th className="px-3 py-2 font-semibold text-brand-ink">Status</th>
                <th className="px-3 py-2 font-semibold text-brand-ink">Claimed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-ink/10">
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 text-brand-ink">{t.id}</td>
                  <td className="px-3 py-2 text-brand-ink-muted">{t.email ?? '—'}</td>
                  <td className="px-3 py-2 text-brand-ink-muted">
                    {[t.firstName, t.lastName].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-brand-ink-muted">{t.status ?? '—'}</td>
                  <td className="px-3 py-2 text-brand-ink-muted">{t.claimedByUid ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor ? (
        <div className="mt-3">
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">Ticketing</h1>
        <p className="text-sm text-brand-ink-muted">
          Provider status, CSV import for the manual/no-vendor path (spec §3.3), and the ticket list.
        </p>
      </div>

      <StatusCard status={status} error={statusError} onRefresh={refreshStatus} busy={statusBusy} />
      <ImportPanel call={call} onImported={onImported} />
      <TicketList call={call} refreshToken={refreshToken} />
    </div>
  );
}
