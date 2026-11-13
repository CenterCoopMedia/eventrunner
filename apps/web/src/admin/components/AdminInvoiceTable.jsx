import { Link } from 'react-router';
import { formatMoney } from 'shared/invoice';
import { INVOICES_ROOT, INVOICE_STATUS_TONES, INVOICE_STATUS_WORDS } from '../invoiceDoc.js';
import { rowTitleLinkClass } from './formControls.jsx';
import { StatusBadge } from './adminChrome.jsx';
import RuledTable from './RuledTable.jsx';

export default function AdminInvoiceTable({ rows }) {
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
        <span className="inline-flex flex-wrap items-center gap-3xs">
          <StatusBadge tone={INVOICE_STATUS_TONES[invoice.status] ?? 'neutral'} data-invoice-status={invoice.status}>
            {INVOICE_STATUS_WORDS[invoice.status] ?? 'Unknown'}
          </StatusBadge>
          {/* A card payment waits for an operator's review (#519). */}
          {invoice.needsReview ? <StatusBadge tone="error" data-invoice-review="">Needs review</StatusBadge> : null}
        </span>
      ),
      due: invoice.dueDate ? <span className="font-admin-data tabular-nums">{invoice.dueDate}</span> : 'No due date',
      total: formatMoney(invoice.totals?.total ?? 0, invoice.currency),
    },
  }));
  return (
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
  );
}

