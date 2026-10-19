import { useEffect, useRef, useState } from 'react';
import { Checkbox } from '../../components/forms/Choice.jsx';
import { currencyDigits, formatTicketMoney, formatTicketTime } from '../../lib/ticketingCommerce.js';
import { Notice, Panel, primaryButtonClass, secondaryButtonClass, TextAreaField, TextField, SelectField, dangerButtonClass } from './formControls.jsx';

function emptyCatalog() {
  return { schemaVersion: 1, revision: 0, published: false, salesPaused: true, currency: 'usd', capacity: 100, maxPerOrder: 10,
    refundPolicy: '', taxTreatment: 'not_collected', commercialTermsConfirmed: false, salesStartAt: null, salesEndAt: null,
    ticketTypes: [{ id: 'general', name: 'General admission', description: '', unitAmount: 0, capacity: 100, active: true,
      visibility: 'public', minPerOrder: 1, maxPerOrder: 10, salesStartAt: null, salesEndAt: null }] };
}

function priceInputsFor(catalog) {
  return Object.fromEntries(catalog.ticketTypes.map((type) => [type.id, String(type.unitAmount / (10 ** currencyDigits(catalog.currency)))]));
}

// The editor state a saved catalog loads as. A draft equal to its baseline
// holds no unsaved edits.
function editorState(catalog) {
  const draft = structuredClone(catalog || emptyCatalog());
  return { draft, priceInputs: priceInputsFor(draft) };
}

function sameEditorState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function utcInput(value) { return value ? String(value).slice(0, 16) : ''; }
function fromUtcInput(value) { return value ? `${value}:00.000Z` : null; }

export default function StripeCatalogPanel({ call, data, isOperator, timezone, onSaved }) {
  const [baseline, setBaseline] = useState(() => editorState(data.catalog));
  const [draft, setDraft] = useState(() => structuredClone(baseline.draft));
  const [priceInputs, setPriceInputs] = useState(() => ({ ...baseline.priceInputs }));
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [baseRevision, setBaseRevision] = useState(data.catalog?.revision || 0);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState(null);
  const [priceErrors, setPriceErrors] = useState({});
  const errorRef = useRef(null);
  useEffect(() => { if (notice?.tone === 'error') errorRef.current?.focus(); }, [notice]);
  const changed = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const updateType = (index, key, value) => setDraft((previous) => ({ ...previous, ticketTypes: previous.ticketTypes.map((type, current) => current === index ? { ...type, [key]: value } : type) }));
  const quantity = (value) => value === '' ? '' : Number(value);
  const revisionChanged = baseRevision !== (data.catalog?.revision || 0);
  const clean = !recoveryRequired && sameEditorState({ draft, priceInputs }, baseline);

  // Load a saved catalog into the editor and make it the new baseline.
  function loadSaved(catalog) {
    const next = editorState(catalog);
    setBaseline(next);
    setDraft(structuredClone(next.draft));
    setPriceInputs({ ...next.priceInputs });
    setBaseRevision(next.draft.revision || 0);
  }

  // A sales change (or another operator's save) writes a new revision. An
  // editor with no unsaved edits follows it at once, so a later save does not
  // carry the old sales state. Real edits keep the warning and the reload.
  useEffect(() => {
    if (revisionChanged && clean && !busyRef.current) loadSaved(data.catalog);
  }, [revisionChanged, clean, data.catalog]);

  async function reloadCatalog() {
    if (busyRef.current || !isOperator) return;
    busyRef.current = true;
    setBusy(true);
    setReloading(true);
    setNotice(null);
    try {
      const result = await call('ticketingCommerceAdmin', { action: 'catalog' });
      loadSaved(result.catalog);
      setPriceErrors({});
      setRecoveryRequired(false);
      setNotice({ tone: 'ok', message: 'The current saved catalog is loaded. Review it before making more changes.' });
      onSaved(result);
    } catch (err) {
      setRecoveryRequired(true);
      setNotice({ tone: 'error', message: err.message });
    } finally { busyRef.current = false; setBusy(false); setReloading(false); }
  }

  async function save(event) {
    event.preventDefault();
    if (busyRef.current || !isOperator) return;
    if (recoveryRequired) {
      setNotice({ tone: 'error', message: 'Reload the saved catalog before saving again. Your unsaved edits are still here.' });
      return;
    }
    if (revisionChanged) {
      setNotice({ tone: 'error', message: 'The catalog changed since you opened this form. Reload the saved catalog before making more changes.' });
      return;
    }
    const scale = 10 ** currencyDigits(draft.currency);
    const catalog = { ...draft, currency: draft.currency.toLowerCase(), ticketTypes: draft.ticketTypes.map((type) => ({ ...type, unitAmount: Math.round(Number(priceInputs[type.id]) * scale) })) };
    const invalidPrices = Object.fromEntries(draft.ticketTypes.filter((type) => !/^\d+(\.\d+)?$/.test(priceInputs[type.id] || '') || (priceInputs[type.id].split('.')[1]?.length || 0) > currencyDigits(draft.currency) || !Number.isSafeInteger(catalog.ticketTypes.find((candidate) => candidate.id === type.id)?.unitAmount)).map((type) => [type.id, `Enter a non-negative price with no more than ${currencyDigits(draft.currency)} decimal places.`]));
    setPriceErrors(invalidPrices);
    if (Object.keys(invalidPrices).length) {
      setNotice({ tone: 'error', message: 'Correct the marked ticket prices before saving.' });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await call('ticketingCommerceAdmin', { action: 'saveCatalog', catalog, expectedRevision: baseRevision });
      loadSaved(result.catalog);
      setNotice({ tone: 'ok', message: 'Catalog saved. Existing orders keep the prices they were issued with.' });
      onSaved(result);
    } catch (err) { setRecoveryRequired(true); setNotice({ tone: 'error', message: err.message }); }
    finally { busyRef.current = false; setBusy(false); }
  }

  if (!isOperator) return <Panel title="Ticket catalog"><p className="text-admin-sm text-admin-ink-secondary">An operator manages prices, capacity, and sales. You can manage individual tickets below.</p></Panel>;
  return (
    <Panel title="Ticket catalog" description="One currency, full-event admission, and prices that include every amount the attendee will pay. Early-bird types share the event’s total capacity.">
      <form className="space-y-md" onSubmit={save} noValidate>
        {recoveryRequired || revisionChanged ? <div className="space-y-sm"><Notice tone="caution" message={recoveryRequired ? 'The save could not be confirmed. Your unsaved edits are still here. Reload the saved catalog to check the current version before saving again.' : 'The saved catalog has changed. Your unsaved edits are still here; reload to use the current saved version.'} /><button type="button" className={secondaryButtonClass} aria-busy={reloading} aria-disabled={busy} onClick={reloadCatalog}>{reloading ? 'Reloading saved catalog…' : 'Discard unsaved edits and reload catalog'}</button></div> : null}
        <div className="grid gap-md sm:grid-cols-2">
          {data.catalog ? <TextField label="Currency" value={draft.currency.toUpperCase()} readOnly hint="Currency is fixed after the first catalog is saved." /> : <SelectField label="Currency" value={draft.currency.toLowerCase()} onChange={(value) => changed('currency', value)} options={['usd', 'cad', 'eur', 'gbp', 'aud', 'nzd'].map((currency) => ({ value: currency, label: currency.toUpperCase() }))} />}
          <TextField label="Event capacity" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={draft.capacity} onChange={(value) => changed('capacity', quantity(value))} />
          <TextField label="Maximum tickets per order" type="number" inputMode="numeric" min="1" max="20" step="1" value={draft.maxPerOrder} onChange={(value) => changed('maxPerOrder', quantity(value))} />
          <SelectField label="Tax treatment" value={draft.taxTreatment} onChange={(value) => changed('taxTreatment', value)} options={[{ value: 'inclusive', label: 'Tax included in ticket prices' }, { value: 'not_collected', label: 'No tax collected for this event' }]} />
          <TextField label="Event sales start (UTC)" type="datetime-local" value={utcInput(draft.salesStartAt)} hint={draft.salesStartAt ? `Event time: ${formatTicketTime(draft.salesStartAt, timezone)}` : 'Leave blank for no start restriction.'} onChange={(value) => changed('salesStartAt', fromUtcInput(value))} />
          <TextField label="Event sales end (UTC)" type="datetime-local" value={utcInput(draft.salesEndAt)} hint={draft.salesEndAt ? `Event time: ${formatTicketTime(draft.salesEndAt, timezone)}` : 'Leave blank for no end restriction.'} onChange={(value) => changed('salesEndAt', fromUtcInput(value))} />
        </div>
        <p className="text-admin-sm text-admin-ink-secondary">Times are entered in UTC and shown beside each field in the event’s timezone. Processing fees are paid by the organizer. No tax exemption is inferred from the tax setting.</p>
        <TextAreaField label="Refund policy" value={draft.refundPolicy} onChange={(value) => changed('refundPolicy', value)} rows={4} maxLength={2000} hint="Attendees must see and accept these terms before proceeding to payment." />
        <Checkbox tone="admin" label="Commercial terms are approved for this event" checked={draft.commercialTermsConfirmed} onChange={(event) => changed('commercialTermsConfirmed', event.target.checked)} />
        <p className="text-admin-sm text-admin-ink-secondary">Confirm the organizer’s merchant account, currency, taxes, refund/support responsibilities, and fee allocation before opening sales.</p>
        <Checkbox tone="admin" label="Publish the catalog" checked={draft.published} onChange={(event) => changed('published', event.target.checked)} />
        <Checkbox tone="admin" label="Pause new sales" checked={draft.salesPaused} onChange={(event) => changed('salesPaused', event.target.checked)} />
        <div className="space-y-md">
          <h3 className="text-admin-lg font-bold">Ticket types</h3>
          {draft.ticketTypes.map((type, index) => <fieldset key={type.id} className="min-w-0 space-y-sm rounded-admin-panel border-admin-hairline border-admin-rule-hairline p-md">
            <legend className="px-xs text-admin-base font-bold">{type.name || `Ticket type ${index + 1}`}</legend>
            <p className="font-admin-data text-admin-xs text-admin-ink-data">{type.id}</p>
            <div className="grid gap-md sm:grid-cols-2">
              <TextField label="Ticket name" value={type.name} maxLength={120} onChange={(value) => updateType(index, 'name', value)} />
              <TextField label={`Price (${draft.currency.toUpperCase()})`} type="text" inputMode="decimal" value={priceInputs[type.id] ?? '0'} error={priceErrors[type.id]} hint={`0 for free admission. Current preview: ${formatTicketMoney(Math.round(Number(priceInputs[type.id]) * (10 ** currencyDigits(draft.currency))), draft.currency)}`} onChange={(value) => setPriceInputs((previous) => ({ ...previous, [type.id]: value }))} />
              <TextField label="Ticket-type capacity" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={type.capacity} onChange={(value) => updateType(index, 'capacity', quantity(value))} />
              <SelectField label="Availability" value={type.visibility} onChange={(value) => updateType(index, 'visibility', value)} options={[{ value: 'public', label: 'Public ticket selection' }, { value: 'hidden', label: 'Hidden — staff-issued only' }]} />
              <TextField label="Minimum per order" type="number" inputMode="numeric" min="1" max="20" step="1" value={type.minPerOrder} onChange={(value) => updateType(index, 'minPerOrder', quantity(value))} />
              <TextField label="Maximum per order" type="number" inputMode="numeric" min="1" max="20" step="1" value={type.maxPerOrder} onChange={(value) => updateType(index, 'maxPerOrder', quantity(value))} />
              <TextField label="Ticket sales start (UTC)" type="datetime-local" value={utcInput(type.salesStartAt)} hint={type.salesStartAt ? `Event time: ${formatTicketTime(type.salesStartAt, timezone)}` : 'Uses the event’s start restriction.'} onChange={(value) => updateType(index, 'salesStartAt', fromUtcInput(value))} />
              <TextField label="Ticket sales end (UTC)" type="datetime-local" value={utcInput(type.salesEndAt)} hint={type.salesEndAt ? `Event time: ${formatTicketTime(type.salesEndAt, timezone)}` : 'Uses the event’s end restriction.'} onChange={(value) => updateType(index, 'salesEndAt', fromUtcInput(value))} />
            </div>
            <TextAreaField label="Ticket description" value={type.description} maxLength={1000} onChange={(value) => updateType(index, 'description', value)} />
            <Checkbox tone="admin" label="Ticket type is active" checked={type.active} onChange={(event) => updateType(index, 'active', event.target.checked)} />
            {!data.catalog?.ticketTypes?.some((saved) => saved.id === type.id) ? <button type="button" className={dangerButtonClass} onClick={() => changed('ticketTypes', draft.ticketTypes.filter((_, current) => current !== index))}>Remove unsaved ticket type</button> : <p className="text-admin-sm text-admin-ink-secondary">To retire this type, make it inactive. Historical orders retain its identity and price.</p>}
          </fieldset>)}
          <button type="button" className={secondaryButtonClass} aria-disabled={draft.ticketTypes.length >= 20} onClick={() => {
            if (draft.ticketTypes.length >= 20) return;
            const id = `type-${crypto.randomUUID()}`;
            changed('ticketTypes', [...draft.ticketTypes, { id, name: '', description: '', unitAmount: 0, capacity: draft.capacity, active: false, visibility: 'hidden', minPerOrder: 1, maxPerOrder: draft.maxPerOrder, salesStartAt: null, salesEndAt: null }]);
            setPriceInputs((previous) => ({ ...previous, [id]: '0' }));
          }}>{draft.ticketTypes.length >= 20 ? 'Limit reached — 20 ticket types' : 'Add ticket type'}</button>
        </div>
        {notice ? <div ref={errorRef} tabIndex={-1}><Notice tone={notice.tone} message={notice.message} /></div> : null}
        <button type="submit" className={primaryButtonClass} aria-busy={busy && !reloading} aria-disabled={busy || recoveryRequired || revisionChanged}>{busy && !reloading ? 'Saving catalog…' : 'Save catalog'}</button>
      </form>
    </Panel>
  );
}
