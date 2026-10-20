// Invoices (issues #208, #209): every invoice, newest first, with a status filter
// and a search. The rows come from invoiceAdmin, never from Firestore: the
// invoice collections deny every client read (firestore.rules), because an
// invoice names a third party's billing contact.
//
// The status is a word in a badge, never colour alone. The search runs on
// the server over the invoice number, the bill-to name, contact and email,
// and the reference. One page examines a bounded window of invoices, so
// "Show more" continues the same filter from where the last page stopped.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatMoney } from 'shared/invoice';
import { useAdminApi } from '../adminApi.js';
import {
  INVOICES_ROOT,
  INVOICE_SETTINGS_PATH,
  INVOICE_STATUS_TONES,
  INVOICE_STATUS_WORDS,
} from '../invoiceDoc.js';
import RuledTable from '../components/RuledTable.jsx';
import {
  Notice,
  ServerErrorSummary,
  inputClass,
  fieldLabelClass,
  primaryButtonClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';

export const STATUS_FILTERS = Object.freeze([
  { value: '', label: 'All statuses' },
  ...Object.entries(INVOICE_STATUS_WORDS).map(([value, label]) => ({ value, label })),
]);

/** The status the URL names; anything else reads as all. */
export function readStatusFilter(value) {
  return STATUS_FILTERS.some((filter) => filter.value === value) ? value : '';
}

/** One request reads at most this many invoices (functions/src/admin/invoices.cjs MAX_SCAN). */
export const INVOICES_PER_SCAN = 250;

/** "Showing 3 invoices." The noun agrees with the count. */
export function invoiceCountLine(count, more) {
  const noun = count === 1 ? 'invoice' : 'invoices';
  return more ? `Showing ${count} ${noun}. There are more.` : `Showing ${count} ${noun}.`;
}

/** "the Paid invoices that match “press”" for the empty state. */
function filterWords(status, search) {
  const what = status ? `${INVOICE_STATUS_WORDS[status]} invoices` : 'invoices';
  return search ? `${what} that match “${search}”` : what;
}

export default function AdminInvoicesList() {
  const call = useAdminApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = readStatusFilter(searchParams.get('status') ?? '');
  const search = (searchParams.get('q') ?? '').slice(0, 150);
  const [searchText, setSearchText] = useState(search);
  const [rows, setRows] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // How many pages the current filter has read, for the empty state.
  const [scans, setScans] = useState(0);
  // A filter change starts a new generation. An answer from an older one,
  // such as a Show more still in flight when the filter changed, is
  // dropped, so its rows and its cursor never join the new list.
  const generationRef = useRef(0);
  const statusId = useId();
  const searchId = useId();

  const load = useCallback(async ({ cursor = null } = {}) => {
    const body = { action: 'list', limit: 25, ...(status ? { status } : {}), ...(search ? { search } : {}) };
    return call('invoiceAdmin', cursor ? { ...body, cursor } : body);
  }, [call, status, search]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const current = () => generation === generationRef.current;
    setRows(null);
    setNextCursor(null);
    setError(null);
    setLoadingMore(false);
    setScans(0);
    load()
      .then((result) => {
        if (!current()) return;
        setRows(result.invoices ?? []);
        setNextCursor(result.nextCursor ?? null);
        setScans(1);
      })
      .catch((err) => {
        if (current()) {
          setRows([]);
          setError(err);
        }
      });
  }, [load]);

  useEffect(() => {
    setSearchText(search);
  }, [search]);

  function applyFilters(next) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace: true });
  }

  async function showMore() {
    const generation = generationRef.current;
    const current = () => generation === generationRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await load({ cursor: nextCursor });
      if (!current()) return;
      setRows((rowsNow) => [...(rowsNow ?? []), ...(result.invoices ?? [])]);
      setNextCursor(result.nextCursor ?? null);
      setScans((count) => count + 1);
    } catch (err) {
      if (current()) setError(err);
    } finally {
      if (current()) setLoadingMore(false);
    }
  }

  const showMoreButton = (label) => (
    <button
      type="button"
      className={secondaryButtonClass}
      disabled={loadingMore}
      aria-busy={loadingMore || undefined}
      onClick={showMore}
    >
      {loadingMore ? 'Loading…' : label}
    </button>
  );

  const filtered = Boolean(status || search);
  const tableRows = (rows ?? []).map((invoice) => ({
    id: invoice.id,
    cells: {
      invoice: (
        <Link to={`${INVOICES_ROOT}/${encodeURIComponent(invoice.id)}`} className={rowTitleLinkClass}>
          {invoice.number ?? `Draft for ${invoice.billTo?.name || 'no name yet'}`}
        </Link>
      ),
      billTo: invoice.billTo?.name || '—',
      status: (
        <StatusBadge tone={INVOICE_STATUS_TONES[invoice.status] ?? 'neutral'} data-invoice-status={invoice.status}>
          {INVOICE_STATUS_WORDS[invoice.status] ?? invoice.status}
        </StatusBadge>
      ),
      due: invoice.dueDate ? <span className="font-admin-data tabular-nums">{invoice.dueDate}</span> : 'No due date',
      total: formatMoney(invoice.totals?.total ?? 0, invoice.currency),
    },
  }));

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Invoices"
        description="Bills for sponsors and partners. Write a draft, issue it, download its PDF, and record the payment. A draft has no number. The number is given when the invoice is issued."
        actions={
          <>
            <Link to={INVOICE_SETTINGS_PATH} className={secondaryButtonClass}>
              Invoice settings
            </Link>
            <Link to={`${INVOICES_ROOT}/new/invoice`} className={primaryButtonClass}>
              New invoice
            </Link>
          </>
        }
      />

      <form
        role="search"
        aria-label="Find invoices"
        className="flex flex-wrap items-end gap-sm"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters({ q: searchText.trim() });
        }}
      >
        <div className="flex min-w-0 flex-col gap-3xs">
          <label htmlFor={statusId} className={fieldLabelClass}>
            Status
          </label>
          <select
            id={statusId}
            className={inputClass}
            value={status}
            onChange={(event) => applyFilters({ status: event.target.value })}
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value || 'all'} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3xs sm:max-w-[24rem]">
          <label htmlFor={searchId} className={fieldLabelClass}>
            Search
          </label>
          <input
            id={searchId}
            type="search"
            className={inputClass}
            value={searchText}
            maxLength={150}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        <button type="submit" className={secondaryButtonClass}>
          Search
        </button>
        {filtered ? (
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              setSearchText('');
              applyFilters({ status: '', q: '' });
            }}
          >
            Clear filters
          </button>
        ) : null}
      </form>

      <ServerErrorSummary error={error} title="The invoices could not be loaded" />

      {rows === null ? (
        <AdminLoadingState label="Loading invoices…" />
      ) : rows.length === 0 ? (
        filtered && nextCursor ? (
          // One read found no match, and older invoices are still unread.
          // The search goes on from where it stopped; it is not over.
          <AdminEmptyState
            title="No matches yet"
            description={`No matches in the newest ${INVOICES_PER_SCAN * Math.max(scans, 1)} invoices. Older invoices are not searched yet.`}
            action={showMoreButton('Show older invoices')}
          />
        ) : filtered ? (
          <AdminEmptyState
            title="No invoices match"
            description={`There are no ${filterWords(status, search)}.`}
            action={
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => {
                  setSearchText('');
                  applyFilters({ status: '', q: '' });
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : error ? null : (
          <AdminEmptyState
            title="No invoices yet"
            description="Write the first draft. You can pick an organization, and its sponsor package fills the first line."
            action={
              <Link to={`${INVOICES_ROOT}/new/invoice`} className={primaryButtonClass}>
                New invoice
              </Link>
            }
          />
        )
      ) : (
        <>
          <p role="status" className="text-admin-sm text-admin-ink-secondary">
            {invoiceCountLine(rows.length, Boolean(nextCursor))}
          </p>
          <RuledTable
            caption="Invoices, newest first"
            hideCaption
            columns={[
              { id: 'invoice', label: 'Invoice' },
              { id: 'billTo', label: 'Bill to' },
              { id: 'status', label: 'Status' },
              { id: 'due', label: 'Due' },
              { id: 'total', label: 'Total', numeric: true },
            ]}
            rows={tableRows}
            tableClassName="min-w-[40rem]"
          />
          {nextCursor ? <div>{showMoreButton('Show more invoices')}</div> : null}
        </>
      )}
      {rows !== null && rows.length === 0 && !filtered && error ? (
        <Notice tone="caution" message="Reload the page to try again." />
      ) : null}
    </div>
  );
}
