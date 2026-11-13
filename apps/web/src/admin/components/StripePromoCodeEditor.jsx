import HelpTooltip from './HelpTooltip.jsx';
import '../plannerFields.css';
// One promo code's form (ADR 0004 amendment 2026-11-04). It checks the
// fields with the shared validator before sending; the server checks again
// and owns the use count, which this form never sends.
import PlannerSwitch from './PlannerSwitch.jsx';
import { useState } from 'react';
import { validatePromoCode } from 'shared/promoCodes';
import { currencyDigits } from '../../lib/ticketingCommerce.js';
import EventDateTimeField from './EventDateTimeField.jsx';
import { CheckboxField, FieldError, primaryButtonClass, secondaryButtonClass, SelectField, TextField } from './formControls.jsx';

export const EMPTY_PROMO = {
  code: '', kind: 'percent', value: 10, ticketTypeIds: [], maxUses: null, maxPerOrder: null,
  startsAt: null, endsAt: null, active: true,
};

const countText = (value) => (value === null || value === undefined ? '' : String(value));
const countValue = (text) => (text.trim() === '' ? null : Number(text));

/** The amount field in major units, or the percent as typed. */
function valueText(promo, currency) {
  if (promo.kind === 'amount') return String(promo.value / (10 ** currencyDigits(currency)));
  return String(promo.value);
}

function readValue(kind, text, currency) {
  const digits = currencyDigits(currency);
  if (kind === 'percent') return /^\d+$/.test(text.trim()) ? Number(text) : NaN;
  if (!/^\d+(\.\d+)?$/.test(text.trim()) || (text.split('.')[1]?.length || 0) > digits) return NaN;
  return Math.round(Number(text) * (10 ** digits));
}

/**
 * @param {{ promo: object, creating: boolean, catalog: object, timezone: string,
 *   busy: boolean, onSave: (promo: object) => void, onCancel: () => void }} props
 */
export default function StripePromoCodeEditor({ promo, creating, catalog, timezone, busy, onSave, onCancel }) {
  const currency = catalog?.currency || 'usd';
  const [draft, setDraft] = useState(() => ({ ...EMPTY_PROMO, ...promo }));
  const [texts, setTexts] = useState(() => ({
    value: valueText({ ...EMPTY_PROMO, ...promo }, currency),
    maxUses: countText(promo.maxUses), maxPerOrder: countText(promo.maxPerOrder),
  }));
  const [errors, setErrors] = useState({});
  const [timeProblems, setTimeProblems] = useState({});
  const [showTimeErrors, setShowTimeErrors] = useState(false);
  const paidTypes = (catalog?.ticketTypes || []).filter((type) => type.unitAmount > 0);
  const change = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const changeText = (key, value) => setTexts((previous) => ({ ...previous, [key]: value }));
  const timeProblem = (key) => (problem) => setTimeProblems((previous) => (previous[key] ?? null) === problem ? previous : { ...previous, [key]: problem });
  const toggleType = (id) => change('ticketTypeIds', draft.ticketTypeIds.includes(id)
    ? draft.ticketTypeIds.filter((item) => item !== id)
    : [...draft.ticketTypeIds, id]);

  function submit(event) {
    event.preventDefault();
    const candidate = {
      code: draft.code, kind: draft.kind, value: readValue(draft.kind, texts.value, currency),
      ticketTypeIds: draft.ticketTypeIds, maxUses: countValue(texts.maxUses), maxPerOrder: countValue(texts.maxPerOrder),
      startsAt: draft.startsAt, endsAt: draft.endsAt, active: draft.active,
    };
    const verdict = validatePromoCode(candidate);
    const timesHeld = Object.values(timeProblems).some(Boolean);
    setShowTimeErrors(timesHeld);
    setErrors(verdict.errors);
    if (!verdict.ok || timesHeld) return;
    onSave(candidate);
  }

  const valueLabel = draft.kind === 'percent' ? 'Percent off' : `Amount off each ticket (${currency.toUpperCase()})`;
  return (
    <form className="space-y-md" onSubmit={submit} noValidate aria-label={creating ? 'New promo code' : `Edit ${draft.code}`}>
      <div className="planner-fields grid gap-md sm:grid-cols-2">
        {creating ? <TextField help="Attendees enter this at checkout." label="Code" value={draft.code} onChange={(value) => change('code', value)} error={errors.code}
          maxLength={32} autoCapitalize="characters"  /> : <p className="text-admin-base font-semibold">{draft.code}</p>}
        <SelectField help="Choose whether the code takes off a percentage or a fixed amount."
          label="Discount" value={draft.kind} onChange={(value) => change('kind', value)} error={errors.kind}
          options={[{ value: 'percent', label: 'Percent off each ticket' }, { value: 'amount', label: 'Amount off each ticket' }]}
        />
        <TextField help="Enter the discount as a percentage or an amount in the event’s currency, as selected above." label={valueLabel} inputMode={draft.kind === 'percent' ? 'numeric' : 'decimal'} value={texts.value} onChange={(value) => changeText('value', value)} error={errors.value} />
        <TextField help="Discounted tickets over all orders. Empty for no limit." label="Use limit (tickets)" inputMode="numeric" value={texts.maxUses} onChange={(value) => changeText('maxUses', value)} error={errors.maxUses} hint="Discounted tickets over all orders. Empty for no limit." />
        <TextField help="An order with more discounted tickets is refused. Empty for no limit." label="Limit per order (tickets)" inputMode="numeric" value={texts.maxPerOrder} onChange={(value) => changeText('maxPerOrder', value)} error={errors.maxPerOrder} hint="An order with more discounted tickets is refused. Empty for no limit." />
        <EventDateTimeField help="Choose when attendees can begin using this code, on the event’s local clock." label="Code starts" value={draft.startsAt} timeZone={timezone} clearable showError={showTimeErrors} summaryPrefix="Starts" emptySummary="Works as soon as it is saved." onProblemChange={timeProblem('startsAt')} onChange={(value) => change('startsAt', value)} />
        <EventDateTimeField help="Choose when this code expires, on the event’s local clock." label="Code ends" value={draft.endsAt} timeZone={timezone} clearable showError={showTimeErrors || Boolean(errors.endsAt)} summaryPrefix="Ends" emptySummary="No end." onProblemChange={timeProblem('endsAt')} onChange={(value) => change('endsAt', value)} />
      </div>
      <FieldError message={errors.endsAt} />
      <fieldset aria-label={["Tickets it applies to "].join('').trim()} className="min-w-0 space-y-xs">
        <legend className="text-admin-base font-semibold text-admin-ink">Tickets it applies to <HelpTooltip label="Tickets it applies to">Choose the ticket types attendees can buy with this discount code.</HelpTooltip></legend>
        <p className="text-admin-sm text-admin-ink-secondary">Choose none for every paid ticket. Free tickets are never discounted.</p>
        {paidTypes.map((type) => (
          <CheckboxField help="Include this ticket type in the discount code." key={type.id} label={type.name} checked={draft.ticketTypeIds.includes(type.id)} onChange={() => toggleType(type.id)} />
        ))}
        <FieldError message={errors.ticketTypeIds} />
      </fieldset>
      <PlannerSwitch help="Allow attendees to use this code during its start and end dates." label="Code is active" checked={draft.active} onChange={(value) => change('active', value)} />
      <div className="flex flex-wrap gap-sm">
        <button type="submit" className={primaryButtonClass} aria-label={busy ? 'Saving promo code…' : 'Save promo code'} aria-busy={busy} aria-disabled={busy}>{busy ? 'Saving promo code…' : 'Save'}</button>
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
