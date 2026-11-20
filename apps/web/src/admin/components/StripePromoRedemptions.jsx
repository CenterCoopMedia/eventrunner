import { useRef, useState } from 'react';
import { saveTextFile } from '../downloadFile.js';
import { plannerMessage } from '../plannerErrors.js';
import { Notice, secondaryButtonClass } from './formControls.jsx';

function cell(value) {
  const text = String(value ?? '');
  const safe = /^[\t\r\n]|^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportRedemptions(code, rows) {
  const heading = ['Code', 'Order', 'Buyer email', 'Ticket type ID', 'Ticket type', 'Redeemed tickets'];
  const lines = rows.flatMap((row) => row.types.map((type) => [code, row.orderId, row.purchaserEmail, type.id, type.name, type.quantity]));
  const csv = [heading, ...lines].map((line) => line.map(cell).join(',')).join('\r\n');
  saveTextFile(`promo-${code.toLowerCase()}-redemptions.csv`, `${csv}\r\n`);
}

export default function StripePromoRedemptions({ call, code }) {
  const [visible, setVisible] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);

  async function load(cursor, download = false) {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError('');
    try {
      const rows = cursor ? [...report.rows] : [];
      let nextCursor = cursor;
      do {
        const page = await call('ticketingCommerceAdmin', { action: 'promoRedemptions', code, ...(nextCursor ? { cursor: nextCursor } : {}) });
        if (page.nextCursor && page.nextCursor === nextCursor) throw new Error('The redemption report could not continue. Try again.');
        rows.push(...page.redemptions);
        nextCursor = page.nextCursor;
      } while (download && nextCursor);
      setReport({ rows, nextCursor });
      if (download) exportRedemptions(code, rows);
    } catch (err) { setError(plannerMessage(err.message)); }
    finally { loading.current = false; setBusy(false); }
  }

  const total = report?.rows.reduce((sum, row) => sum + row.count, 0);
  return <div className="w-full space-y-sm">
    <button type="button" className={secondaryButtonClass} aria-expanded={visible} onClick={() => {
      setVisible(!visible);
      if (!visible && !report) load();
    }}>{visible ? `Hide redemptions for ${code}` : `View redemptions for ${code}`}</button>
    {visible ? <div className="space-y-sm">
      {busy ? <p role="status">Loading redemptions…</p> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      {report ? <>
        <p role="status">{total} redeemed {total === 1 ? 'ticket' : 'tickets'}{report.nextCursor ? ' loaded so far' : ''}.</p>
        {report.rows.length ? <ul className="space-y-sm">
          {report.rows.map((row) => <li key={row.orderId} className="wrap-anywhere">
            <p>{row.purchaserEmail || 'Buyer email unavailable'}</p>
            <p className="text-admin-sm text-admin-ink-secondary">{row.types.map((type) => `${type.quantity} × ${type.name}`).join(', ')}</p>
          </li>)}
        </ul> : null}
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => {
          if (report.nextCursor) load(report.nextCursor, true);
          else exportRedemptions(code, report.rows);
        }}>Download redemptions CSV</button>
      </> : null}
      {report?.nextCursor || error ? <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => load(report?.nextCursor)}>{error ? 'Retry redemptions' : 'Load more redemptions'}</button> : null}
    </div> : null}
  </div>;
}
