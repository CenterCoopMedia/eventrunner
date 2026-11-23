import AdminPendingSave from './AdminPendingSave.jsx';
import { plannerMessage } from '../plannerErrors.js';
import '../plannerFields.css';
import AdminIconControl from './AdminIconControl.jsx';
import PlannerSwitch from './PlannerSwitch.jsx';
import { useEffect, useRef, useState } from 'react';
import { Checkbox } from '../../components/forms/Choice.jsx';
import { currencyDigits, formatTicketMoney } from '../../lib/ticketingDetails.js';
import EventDateTimeField from './EventDateTimeField.jsx';
import { Notice, Panel, primaryButtonClass, secondaryButtonClass, TextAreaField, TextField, SelectField, dangerButtonClass } from './formControls.jsx';

function emptyCatalog() {
  return { schemaVersion: 1, revision: 0, published: false, salesPaused: true, currency: 'usd', capacity: 100, maxPerOrder: 10,
    refundPolicy: '', taxTreatment: 'not_collected', commercialTermsConfirmed: false, salesStartAt: null, salesEndAt: null,
    ticketTypes: [{ id: 'general', name: 'General admission', description: '', unitAmount: 0, capacity: 100, active: true,
      visibility: 'public', minPerOrder: 1, maxPerOrder: 10, salesStartAt: null, salesEndAt: null }], addOns: [] };
}

const MAX_ADD_ONS = 10;
// Add-on prices share the price inputs with ticket types under their own keys.
const addOnKey = (id) => `addon:${id}`;

function priceInputsFor(catalog) {
  const scale = 10 ** currencyDigits(catalog.currency);
  return Object.fromEntries([
    ...catalog.ticketTypes.map((type) => [type.id, String(type.unitAmount / scale)]),
    ...(catalog.addOns || []).map((addOn) => [addOnKey(addOn.id), String(addOn.unitAmount / scale)]),
  ]);
}

// The editor state a saved catalog loads as. A draft equal to its baseline
// holds no unsaved edits.
function editorState(catalog) {
  const draft = structuredClone(catalog || emptyCatalog());
  draft.addOns ||= [];
  return { draft, priceInputs: priceInputsFor(draft) };
}

function sameEditorState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

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
  // Sales windows are entered on the event's clock (#476). A time the clocks
  // skip or repeat, or half a date and time, holds the save.
  const [timeProblems, setTimeProblems] = useState({});
  const [showTimeErrors, setShowTimeErrors] = useState(false);
  // A reload discards unsaved edits. The date fields hold half-entered input
  // of their own, so each reload mounts them again from the saved values.
  const [loads, setLoads] = useState(0);
  const timeProblem = (key) => (problem) => setTimeProblems((previous) => (previous[key] ?? null) === problem ? previous : { ...previous, [key]: problem });
  const errorRef = useRef(null);
  useEffect(() => { if (notice?.tone === 'error') errorRef.current?.focus(); }, [notice]);
  const changed = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const updateType = (index, key, value) => setDraft((previous) => ({ ...previous, ticketTypes: previous.ticketTypes.map((type, current) => current === index ? { ...type, [key]: value } : type) }));
  const updateAddOn = (index, key, value) => setDraft((previous) => ({ ...previous, addOns: previous.addOns.map((addOn, current) => current === index ? { ...addOn, [key]: value } : addOn) }));
  const quantity = (value) => value === '' ? '' : Number(value);
  const revisionChanged = baseRevision !== (data.catalog?.revision || 0);
  // A sales time field holding a half-entered or unsettled time is an unsaved
  // edit too, though the draft does not carry it yet.
  const timesPending = Object.values(timeProblems).some(Boolean);
  const clean = !recoveryRequired && !timesPending && sameEditorState({ draft, priceInputs }, baseline);

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
  // The busy state is a dependency, so a revision that lands during a save
  // or a reload is applied when that request ends.
  useEffect(() => {
    if (!revisionChanged || !clean || busy) return;
    loadSaved(data.catalog);
    setNotice({ tone: 'ok', message: 'The editor now shows the current saved catalog.' });
  }, [revisionChanged, clean, busy, data.catalog]);

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
      setTimeProblems({});
      setShowTimeErrors(false);
      setLoads((count) => count + 1);
      setRecoveryRequired(false);
      setNotice({ tone: 'ok', message: 'The current saved catalog is loaded. Review it before making more changes.' });
      onSaved(result);
    } catch (err) {
      setRecoveryRequired(true);
      setNotice({ tone: 'error', message: plannerMessage(err.message) });
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
    const catalog = {
      ...draft, currency: draft.currency.toLowerCase(),
      ticketTypes: draft.ticketTypes.map((type) => ({ ...type, unitAmount: Math.round(Number(priceInputs[type.id]) * scale) })),
      addOns: draft.addOns.map((addOn) => ({ ...addOn, capacity: addOn.capacity === '' ? null : addOn.capacity, unitAmount: Math.round(Number(priceInputs[addOnKey(addOn.id)]) * scale) })),
    };
    const amounts = Object.fromEntries([
      ...catalog.ticketTypes.map((type) => [type.id, type.unitAmount]),
      ...catalog.addOns.map((addOn) => [addOnKey(addOn.id), addOn.unitAmount]),
    ]);
    const invalidPrices = Object.fromEntries(Object.keys(amounts).filter((key) => !/^\d+(\.\d+)?$/.test(priceInputs[key] || '') || (priceInputs[key].split('.')[1]?.length || 0) > currencyDigits(draft.currency) || !Number.isSafeInteger(amounts[key])).map((key) => [key, `Enter a non-negative price with no more than ${currencyDigits(draft.currency)} decimal places.`]));
    setPriceErrors(invalidPrices);
    const timesHeld = Object.values(timeProblems).some(Boolean);
    if (timesHeld) setShowTimeErrors(true);
    if (timesHeld || Object.keys(invalidPrices).length) {
      const marked = [timesHeld ? 'sales times' : null, Object.keys(invalidPrices).length ? 'ticket prices' : null].filter(Boolean).join(' and ');
      setNotice({ tone: 'error', message: `Correct the marked ${marked} before saving.` });
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
    } catch (err) { setRecoveryRequired(true); setNotice({ tone: 'error', message: plannerMessage(err.message) }); }
    finally { busyRef.current = false; setBusy(false); }
  }

  if (!isOperator) return <Panel title="Ticket catalog"><p className="text-admin-sm text-admin-ink-secondary">An operator manages prices, capacity, and sales. You can manage individual tickets below.</p></Panel>;
  return (
    <Panel title="Ticket catalog" description="One currency, full-event admission, and prices that include every amount the attendee will pay. Early-bird types share the event’s total capacity.">
      <form className="space-y-md" onSubmit={save} noValidate>
        <AdminPendingSave busy={busy && !reloading} to="/admin/ticketing" />
        {recoveryRequired || revisionChanged ? <div className="space-y-sm"><Notice tone="caution" message={recoveryRequired ? 'The save could not be confirmed. Your unsaved edits are still here. Reload the saved catalog to check the current version before saving again.' : 'The saved catalog has changed. Your unsaved edits are still here; reload to use the current saved version.'} /><button type="button" className={secondaryButtonClass} aria-busy={reloading} aria-disabled={busy} onClick={reloadCatalog}>{reloading ? 'Reloading saved catalog…' : 'Discard unsaved edits and reload catalog'}</button></div> : null}
        <div className="planner-fields grid gap-md sm:grid-cols-2">
          {data.catalog ? <p className="text-admin-base text-admin-ink"><span className="font-semibold">Currency</span> {draft.currency.toUpperCase()}</p> : <SelectField label="Currency" value={draft.currency.toLowerCase()} onChange={(value) => changed('currency', value)} options={['usd', 'cad', 'eur', 'gbp', 'aud', 'nzd'].map((currency) => ({ value: currency, label: currency.toUpperCase() }))} />}
          <TextField label="Event capacity" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={draft.capacity} onChange={(value) => changed('capacity', quantity(value))} />
          <TextField label="Maximum tickets per order" type="number" inputMode="numeric" min="1" max="20" step="1" value={draft.maxPerOrder} onChange={(value) => changed('maxPerOrder', quantity(value))} />
          <SelectField label="Tax treatment" value={draft.taxTreatment} onChange={(value) => changed('taxTreatment', value)} options={[{ value: 'inclusive', label: 'Tax included in ticket prices' }, { value: 'not_collected', label: 'No tax collected for this event' }]} />
          <EventDateTimeField key={`salesStartAt-${loads}`} label="Event sales start" value={draft.salesStartAt} timeZone={timezone} clearable showError={showTimeErrors} summaryPrefix="Sales start" emptySummary="No start restriction." onProblemChange={timeProblem('salesStartAt')} onChange={(value) => changed('salesStartAt', value)} />
          <EventDateTimeField key={`salesEndAt-${loads}`} label="Event sales end" value={draft.salesEndAt} timeZone={timezone} clearable showError={showTimeErrors} summaryPrefix="Sales end" emptySummary="No end restriction." onProblemChange={timeProblem('salesEndAt')} onChange={(value) => changed('salesEndAt', value)} />
        </div>
        <p className="text-admin-sm text-admin-ink-secondary">Sales times use the event’s time zone. Processing fees are paid by the organizer. No tax exemption is inferred from the tax setting.</p>
        <TextAreaField label="Refund policy" value={draft.refundPolicy} onChange={(value) => changed('refundPolicy', value)} rows={4} maxLength={2000} hint="Attendees must see and accept these terms before proceeding to payment." />
        <Checkbox tone="admin" label="Commercial terms are approved for this event" checked={draft.commercialTermsConfirmed} onChange={(event) => changed('commercialTermsConfirmed', event.target.checked)} />
        <p className="text-admin-sm text-admin-ink-secondary">Confirm the organizer’s merchant account, currency, taxes, refund/support responsibilities, and fee allocation before opening sales.</p>
        <PlannerSwitch label="Publish tickets" checked={draft.published} onChange={(value) => changed('published', value)} />
        <PlannerSwitch label="Ticket sales" checked={!draft.salesPaused} onChange={(value) => changed('salesPaused', !value)} />
        <div className="space-y-md">
          <h3 className="text-admin-lg font-bold">Ticket types</h3>
          {draft.ticketTypes.map((type, index) => <fieldset key={type.id} className="min-w-0 space-y-sm rounded-admin-panel border-admin-hairline border-admin-rule-hairline p-md">
            <legend className="px-xs text-admin-base font-bold">{type.name || `Ticket type ${index + 1}`}</legend>
            <div className="planner-fields grid gap-md sm:grid-cols-2">
              <TextField label="Ticket name" value={type.name} maxLength={120} onChange={(value) => updateType(index, 'name', value)} />
              <TextField label={`Price (${draft.currency.toUpperCase()})`} type="text" inputMode="decimal" value={priceInputs[type.id] ?? '0'} error={priceErrors[type.id]} hint={`0 for free admission. Current preview: ${formatTicketMoney(Math.round(Number(priceInputs[type.id]) * (10 ** currencyDigits(draft.currency))), draft.currency)}`} onChange={(value) => setPriceInputs((previous) => ({ ...previous, [type.id]: value }))} />
              <TextField label="Ticket-type capacity" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={type.capacity} onChange={(value) => updateType(index, 'capacity', quantity(value))} />
              <SelectField label="Availability" value={type.visibility} onChange={(value) => updateType(index, 'visibility', value)} options={[{ value: 'public', label: 'Public ticket selection' }, { value: 'hidden', label: 'Staff only' }]} />
              <TextField label="Minimum per order" type="number" inputMode="numeric" min="1" max="20" step="1" value={type.minPerOrder} onChange={(value) => updateType(index, 'minPerOrder', quantity(value))} />
              <TextField label="Maximum per order" type="number" inputMode="numeric" min="1" max="20" step="1" value={type.maxPerOrder} onChange={(value) => updateType(index, 'maxPerOrder', quantity(value))} />
              <EventDateTimeField key={`salesStartAt-${loads}`} label="Ticket sales start" value={type.salesStartAt} timeZone={timezone} clearable showError={showTimeErrors} summaryPrefix="Sales start" emptySummary="Uses the event’s start restriction." onProblemChange={timeProblem(`${type.id}.salesStartAt`)} onChange={(value) => updateType(index, 'salesStartAt', value)} />
              <EventDateTimeField key={`salesEndAt-${loads}`} label="Ticket sales end" value={type.salesEndAt} timeZone={timezone} clearable showError={showTimeErrors} summaryPrefix="Sales end" emptySummary="Uses the event’s end restriction." onProblemChange={timeProblem(`${type.id}.salesEndAt`)} onChange={(value) => updateType(index, 'salesEndAt', value)} />
            </div>
            <TextAreaField label="Ticket description" value={type.description} maxLength={1000} onChange={(value) => updateType(index, 'description', value)} />
            <PlannerSwitch label="Ticket type is active" checked={type.active} onChange={(value) => updateType(index, 'active', value)} />
            {!data.catalog?.ticketTypes?.some((saved) => saved.id === type.id) ? <AdminIconControl label={`Remove ${type.name || 'ticket type'}`} icon="remove" className={dangerButtonClass} onClick={() => setDraft((previous) => ({
              ...previous,
              ticketTypes: previous.ticketTypes.filter((_, current) => current !== index),
              addOns: previous.addOns.map((addOn) => ({ ...addOn, ticketTypeIds: addOn.ticketTypeIds.filter((id) => id !== type.id) })),
            }))} /> : <p className="text-admin-sm text-admin-ink-secondary">To retire this type, make it inactive. Historical orders retain its identity and price.</p>}
          </fieldset>)}
          <button type="button" className={secondaryButtonClass} aria-disabled={draft.ticketTypes.length >= 20} onClick={() => {
            if (draft.ticketTypes.length >= 20) return;
            const id = `type-${crypto.randomUUID()}`;
            changed('ticketTypes', [...draft.ticketTypes, { id, name: '', description: '', unitAmount: 0, capacity: draft.capacity, active: false, visibility: 'hidden', minPerOrder: 1, maxPerOrder: draft.maxPerOrder, salesStartAt: null, salesEndAt: null }]);
            setPriceInputs((previous) => ({ ...previous, [id]: '0' }));
          }}>{draft.ticketTypes.length >= 20 ? '20 ticket types maximum' : 'Add ticket type'}</button>
        </div>
        <div className="space-y-md">
          <h3 className="text-admin-lg font-bold">Add-ons</h3>
          <p className="text-admin-sm text-admin-ink-secondary">An add-on is an optional extra, such as a reception, that a buyer adds to a ticket. It is not admission and does not use event capacity. A free ticket with a paid add-on charges only the add-on.</p>
          {draft.addOns.map((addOn, index) => <fieldset key={addOn.id} className="min-w-0 space-y-sm rounded-admin-panel border-admin-hairline border-admin-rule-hairline p-md">
            <legend className="px-xs text-admin-base font-bold">{addOn.name || `Add-on ${index + 1}`}</legend>
            <div className="planner-fields grid gap-md sm:grid-cols-2">
              <TextField label="Add-on name" value={addOn.name} maxLength={120} onChange={(value) => updateAddOn(index, 'name', value)} />
              <TextField label={`Add-on price (${draft.currency.toUpperCase()})`} type="text" inputMode="decimal" value={priceInputs[addOnKey(addOn.id)] ?? '0'} error={priceErrors[addOnKey(addOn.id)]} hint={`Charged for each ticket that adds it. Current preview: ${formatTicketMoney(Math.round(Number(priceInputs[addOnKey(addOn.id)]) * (10 ** currencyDigits(draft.currency))), draft.currency)}`} onChange={(value) => setPriceInputs((previous) => ({ ...previous, [addOnKey(addOn.id)]: value }))} />
              <TextField label="Add-on capacity" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={addOn.capacity ?? ''} hint="Leave empty for no limit." onChange={(value) => updateAddOn(index, 'capacity', value === '' ? null : Number(value))} />
            </div>
            <TextAreaField label="Add-on description" value={addOn.description} maxLength={1000} hint="Buyers see this under the add-on name." onChange={(value) => updateAddOn(index, 'description', value)} />
            <TextField label="Required acknowledgement" value={addOn.acknowledgement} maxLength={300} hint="Optional. Buyers must check this statement to add it, for example: I am 21 or older." onChange={(value) => updateAddOn(index, 'acknowledgement', value)} />
            <fieldset className="space-y-xs">
              <legend className="text-admin-base font-semibold">Offered with</legend>
              {draft.ticketTypes.map((type) => <Checkbox key={type.id} tone="admin" label={type.name || type.id} checked={addOn.ticketTypeIds.includes(type.id)} onChange={(event) => updateAddOn(index, 'ticketTypeIds', event.target.checked ? [...addOn.ticketTypeIds, type.id] : addOn.ticketTypeIds.filter((id) => id !== type.id))} />)}
            </fieldset>
            <PlannerSwitch label="Add-on is on sale" checked={addOn.active} onChange={(value) => updateAddOn(index, 'active', value)} />
            {!data.catalog?.addOns?.some((saved) => saved.id === addOn.id) ? <AdminIconControl label={`Remove ${addOn.name || 'add-on'}`} icon="remove" className={dangerButtonClass} onClick={() => changed('addOns', draft.addOns.filter((_, current) => current !== index))} /> : <p className="text-admin-sm text-admin-ink-secondary">To stop selling this add-on, turn it off. Orders keep the add-ons they were sold with.</p>}
          </fieldset>)}
          <button type="button" className={secondaryButtonClass} aria-disabled={draft.addOns.length >= MAX_ADD_ONS} onClick={() => {
            if (draft.addOns.length >= MAX_ADD_ONS) return;
            const id = `addon-${crypto.randomUUID()}`;
            changed('addOns', [...draft.addOns, { id, name: '', description: '', unitAmount: 0, capacity: null, active: false, acknowledgement: '', ticketTypeIds: draft.ticketTypes.map((type) => type.id) }]);
            setPriceInputs((previous) => ({ ...previous, [addOnKey(id)]: '0' }));
          }}>{draft.addOns.length >= MAX_ADD_ONS ? `${MAX_ADD_ONS} add-ons maximum` : 'Add add-on'}</button>
        </div>
        {notice ? <div ref={errorRef} tabIndex={-1}><Notice tone={notice.tone} message={notice.message} /></div> : null}
        <button type="submit" className={primaryButtonClass} aria-label={busy && !reloading ? 'Saving catalog…' : 'Save ticket settings'} aria-busy={busy && !reloading} aria-disabled={busy || recoveryRequired || revisionChanged}>{busy && !reloading ? 'Saving catalog…' : 'Save'}</button>
      </form>
    </Panel>
  );
}
