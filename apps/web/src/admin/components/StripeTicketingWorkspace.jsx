import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { isReadOnlyDemo } from '../../lib/readOnlyDemo.js';
import { AdminLoadingState, StatusBadge } from './adminChrome.jsx';
import { Notice, Panel, secondaryButtonClass, TextAreaField } from './formControls.jsx';
import StripeCatalogPanel from './StripeCatalogPanel.jsx';
import StripeTicketList from './StripeTicketList.jsx';
import StripeOrderDetail from './StripeOrderDetail.jsx';
import StripeCompPanel from './StripeCompPanel.jsx';
import StripeCheckInPanel from './StripeCheckInPanel.jsx';
import TicketingConfirmation from './TicketingConfirmation.jsx';

export default function StripeTicketingWorkspace({ call }) {
  const { isOperator, user } = useAuth();
  const { eventConfig } = useEventConfig();
  const demo = isReadOnlyDemo(eventConfig);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [orderId, setOrderId] = useState(null);
  const [pause, setPause] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const detailRef = useRef(null);
  const bump = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => {
    if (demo) return undefined;
    let active = true;
    call('ticketingCommerceAdmin', { action: 'catalog' }).then((result) => { if (active) setData(result); }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [call, demo, refresh]);
  useEffect(() => { if (orderId) detailRef.current?.scrollIntoView?.({ block: 'start' }); }, [orderId]);

  async function changeSales() {
    if (busyRef.current) return;
    if (!reason.trim()) { setError('Enter a reason for the sales change.'); return; }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await call('ticketingCommerceAdmin', { action: 'pauseSales', paused: pause, reason: reason.trim() });
      if (result.catalog) setData(result);
      else setData(await call('ticketingCommerceAdmin', { action: 'catalog' }));
      setPause(null);
      bump();
    } catch (err) { setError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  }

  if (demo) return <Notice message="This event demo does not sell tickets, take payments, or issue admission." />;
  if (!data) return error ? <div className="space-y-sm">
    <Notice tone="error" message={error} />
    <button type="button" className={secondaryButtonClass} onClick={() => { setError(''); bump(); }}>Retry Stripe ticketing</button>
  </div> : <AdminLoadingState label="Loading Stripe ticketing…" />;
  return <div className="min-w-0 space-y-md" key={user?.uid}>
    <Panel title="Stripe sales" description="Payment and ticket ownership are separate. Existing Checkout sessions continue to reconcile while new sales are paused.">
      <div className="flex flex-wrap items-center gap-sm">
        <StatusBadge tone={data.mode === 'live' ? 'caution' : 'info'}>{data.mode === 'live' ? 'Live payments' : 'Test mode'}</StatusBadge>
        <StatusBadge tone={data.catalog?.salesPaused || !data.catalog?.published ? 'caution' : 'ok'}>{!data.catalog?.published ? 'Catalog unpublished' : data.catalog.salesPaused ? 'New sales paused' : 'New sales enabled'}</StatusBadge>
        {isOperator ? <button type="button" className={secondaryButtonClass} onClick={() => { setPause(!data.catalog?.salesPaused); setReason(''); setError(''); }}>{data.catalog?.salesPaused ? 'Review reopening sales' : 'Review pausing sales'}</button> : null}
      </div>
      {data.inventory ? <dl className="mt-sm grid gap-sm sm:grid-cols-3"><div><dt className="text-admin-base font-semibold">Event capacity</dt><dd className="font-admin-data">{data.catalog?.capacity ?? 'Not configured'}</dd></div><div><dt className="text-admin-base font-semibold">Seats reserved in checkout</dt><dd className="font-admin-data">{data.inventory.held || 0}</dd></div><div><dt className="text-admin-base font-semibold">Seats issued</dt><dd className="font-admin-data">{data.inventory.sold || 0}</dd></div></dl> : null}
      {error && pause === null ? <div className="mt-sm"><Notice tone="error" message={error} /></div> : null}
    </Panel>
    {isOperator ? <details className="rounded-admin-panel border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-md"><summary className="min-h-admin-control cursor-pointer text-admin-lg font-bold text-admin-ink">Configure ticket catalog</summary><div className="mt-md"><StripeCatalogPanel call={call} data={data} timezone={eventConfig.timezone} isOperator={isOperator} onSaved={(result) => { setData(result); bump(); }} /></div></details> : null}
    <StripeCheckInPanel call={call} timezone={eventConfig.timezone} isOperator={isOperator} onChanged={bump} />
    {orderId ? <div ref={detailRef} className="scroll-mt-lg"><StripeOrderDetail key={orderId} call={call} orderId={orderId} isOperator={isOperator} timezone={eventConfig.timezone} onChanged={bump} onClose={() => setOrderId(null)} /></div> : null}
    <StripeTicketList call={call} kind="orders" catalog={data.catalog} timezone={eventConfig.timezone} refreshToken={refresh} onOpenOrder={setOrderId} />
    <StripeTicketList call={call} kind="tickets" catalog={data.catalog} timezone={eventConfig.timezone} refreshToken={refresh} onOpenOrder={setOrderId} />
    {isOperator ? <details className="rounded-admin-panel border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-md"><summary className="min-h-admin-control cursor-pointer text-admin-lg font-bold text-admin-ink">Issue complimentary admission</summary><div className="mt-md"><StripeCompPanel call={call} catalog={data.catalog} onComplete={(id) => { if (id) setOrderId(id); bump(); }} /></div></details> : null}
    {pause !== null ? <TicketingConfirmation title={pause ? 'Pause new ticket sales?' : 'Reopen new ticket sales?'} confirmLabel={pause ? 'Pause new sales' : 'Reopen new sales'} busy={busy} error={error} onClose={() => { setPause(null); setError(''); }} onConfirm={changeSales}>
      <p>{pause ? 'Attendees will not be able to start new purchases. Existing payment sessions, confirmations, refunds, and check-in continue to reconcile.' : 'Eligible ticket types may be purchased once all catalog and deployment readiness checks pass.'}</p>
      <p>{data.mode === 'live' ? 'This deployment uses live payments.' : 'This deployment uses Stripe test mode.'}</p>
      <TextAreaField label="Reason for changing sales" value={reason} onChange={setReason} required maxLength={500} />
    </TicketingConfirmation> : null}
  </div>;
}
