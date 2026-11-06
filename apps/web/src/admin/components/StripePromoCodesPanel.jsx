// Promo codes for Stripe ticket sales (ADR 0004 amendment 2026-11-04,
// ADR 0008 §6). Staff and operators list, add, change and delete codes. A
// used code cannot be deleted: its orders name it, so it is made inactive.
import AdminIconControl from './AdminIconControl.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatTicketMoney, formatTicketTime } from '../../lib/ticketingCommerce.js';
import { AdminLoadingState, StatusBadge } from './adminChrome.jsx';
import { DestructiveConfirm, Notice, Panel, secondaryButtonClass } from './formControls.jsx';
import StripePromoCodeEditor, { EMPTY_PROMO } from './StripePromoCodeEditor.jsx';

function discountText(code, currency) {
  return code.kind === 'percent'
    ? `${code.value}% off each ticket`
    : `${formatTicketMoney(code.value, currency)} off each ticket`;
}

function ticketsText(code, catalog) {
  if (!code.ticketTypeIds?.length) return 'All paid tickets';
  const names = new Map((catalog?.ticketTypes || []).map((type) => [type.id, type.name]));
  return code.ticketTypeIds.map((id) => names.get(id) || id).join(', ');
}

function windowText(code, timezone) {
  const parts = [];
  if (code.startsAt) parts.push(`Starts ${formatTicketTime(code.startsAt, timezone)}`);
  if (code.endsAt) parts.push(`Ends ${formatTicketTime(code.endsAt, timezone)}`);
  return parts.join(' · ');
}

/** The fields an admin sends: never the use count or the timestamps. */
function editable(code) {
  const { code: name, kind, value, ticketTypeIds, maxUses, maxPerOrder, startsAt, endsAt, active } = code;
  return { code: name, kind, value, ticketTypeIds, maxUses, maxPerOrder, startsAt, endsAt, active };
}

/**
 * @param {{ call: (name: string, body: object) => Promise<any>, catalog: object, timezone: string }} props
 */
export default function StripePromoCodesPanel({ call, catalog, timezone }) {
  const [codes, setCodes] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const currency = catalog?.currency || 'usd';

  const load = useCallback(() => {
    setNotice(null);
    return call('ticketingCommerceAdmin', { action: 'promoCodes' })
      .then((result) => setCodes(result.codes))
      .catch((err) => setNotice({ tone: 'error', message: err.message }));
  }, [call]);
  useEffect(() => { load(); }, [load]);

  async function run(body, done) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await call('ticketingCommerceAdmin', body);
      setCodes(result.codes);
      done?.();
    } catch (err) {
      setNotice({ tone: 'error', message: err.message });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const save = (promo) => run({ action: 'savePromoCode', create: editing.creating, promo }, () => {
    setEditing(null);
    setNotice({ tone: 'ok', message: 'Promo code saved.' });
  });

  return (
    <Panel title="Promo codes" description="A code lowers the price of each eligible ticket at checkout. Limits count discounted tickets. Stripe’s own promotion codes stay off.">
      <div className="space-y-md">
        {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}
        {codes === null && !notice ? <AdminLoadingState label="Loading promo codes…" /> : null}
        {codes === null && notice?.tone === 'error' ? <button type="button" className={secondaryButtonClass} onClick={load}>Retry promo codes</button> : null}
        {codes?.length === 0 && !editing ? <p className="text-admin-sm text-admin-ink-secondary">No promo codes yet.</p> : null}
        {codes?.length ? (
          <ul className="rounded-admin-panel border-admin-hairline border-admin-rule-hairline">
            {codes.map((code) => (
              <li key={code.code} aria-label={code.code} className="flex flex-wrap items-start justify-between gap-sm border-admin-rule-hairline border-b-admin-hairline px-md py-sm last:border-b-0">
                <div className="min-w-0 space-y-2xs">
                  <p className="flex flex-wrap items-center gap-xs">
                    <span className="font-admin-data text-admin-base font-bold text-admin-ink">{code.code}</span>
                    <StatusBadge tone={code.active ? 'ok' : 'caution'}>{code.active ? 'Active' : 'Inactive'}</StatusBadge>
                  </p>
                  <p className="text-admin-sm text-admin-ink">{discountText(code, currency)}</p>
                  <p className="text-admin-sm text-admin-ink-secondary">{ticketsText(code, catalog)}</p>
                  <p className="font-admin-data text-admin-xs text-admin-ink-data">{code.maxUses ? `Used ${code.used} of ${code.maxUses}` : `Used ${code.used}`}{code.maxPerOrder ? ` · At most ${code.maxPerOrder} per order` : ''}</p>
                  {windowText(code, timezone) ? <p className="text-admin-xs text-admin-ink-secondary">{windowText(code, timezone)}</p> : null}
                </div>
                <div className="flex flex-wrap gap-xs">
                  <AdminIconControl className={secondaryButtonClass} label={`Edit ${code.code}`} icon="edit" onClick={() => { setNotice(null); setEditing({ creating: false, promo: editable(code) }); }} />
                  {code.used === 0 ? (
                    <DestructiveConfirm
                      trigger={`Delete ${code.code}`} triggerIcon="delete"
                      title={`Delete ${code.code}?`} confirmLabel="Delete code" busy={busy} busyLabel="Deleting…"
                      consequence="Attendees can no longer use this code." permanence="This cannot be undone."
                      onConfirm={() => run({ action: 'deletePromoCode', code: code.code })}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {editing ? (
          <StripePromoCodeEditor
            key={editing.creating ? 'new' : editing.promo.code}
            promo={editing.promo} creating={editing.creating} catalog={catalog} timezone={timezone} busy={busy}
            onSave={save} onCancel={() => setEditing(null)}
          />
        ) : codes !== null ? (
          <button type="button" className={secondaryButtonClass} onClick={() => { setNotice(null); setEditing({ creating: true, promo: EMPTY_PROMO }); }}>New promo code</button>
        ) : null}
      </div>
    </Panel>
  );
}
