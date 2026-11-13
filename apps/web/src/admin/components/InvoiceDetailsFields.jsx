import { formatMoney } from 'shared/invoice';
import { ADJUSTMENT_WORDS, INVOICE_LIMITS } from '../invoiceDoc.js';
import AdminIconControl from './AdminIconControl.jsx';
import HelpTooltip from './HelpTooltip.jsx';
import { Panel, SelectField, TextAreaField, TextField, linkButtonClass, secondaryButtonClass } from './formControls.jsx';

/** "Line 2" — the name a row's fields and its remove control carry. */
function lineName(index) {
  return `Line ${index + 1}`;
}

function adjustmentName(row, index) {
  return `${ADJUSTMENT_WORDS[row.kind] ?? 'Row'} row ${index + 1}`;
}

/** A list-level problem (too many rows, a negative total) stated in words. */
function FieldErrorLine({ message }) {
  if (!message) return null;
  return (
    <p className="text-admin-sm font-medium text-admin-state-error">
      <span aria-hidden="true" className="font-semibold">! </span>
      {message}
    </p>
  );
}

/** Invoice draft fields. The caller owns validation, focus and every save. */
export default function InvoiceDetailsFields({
  form, currency, organizations, prefillStatus, busy, preview, errorFor, chooseOrganization,
  setBillTo, set, setLine, removeLine, addLine, setAdjustment, removeAdjustment, addAdjustment,
}) {
  const money = (amount) => formatMoney(amount, currency);
  const atLineCap = form.lines.length >= INVOICE_LIMITS.lines;
  const atAdjustmentCap = form.adjustments.length >= INVOICE_LIMITS.adjustments;
  return (
    <fieldset  disabled={busy !== null} className="flex min-w-0 flex-col gap-md">
        <legend className="sr-only">Invoice details </legend>
        <Panel help="Who pays this invoice. Choose an organization to fill the name and its sponsor package." title="Bill to" description="Who pays this invoice. Choose an organization to fill the name and its sponsor package.">
          <div className="flex flex-col gap-sm">
            <SelectField data-help-skip="The label directly names the requested detail; no further explanation needed."
              label="Organization"
              hint={organizations.loading ? 'Loading organizations…' : 'Optional. The name and the first line can still be edited.'}
              value={form.organizationId}
              onChange={chooseOrganization}
              options={[
                { value: '', label: 'No organization' },
                ...organizations.rows.map((row) => ({
                  value: row.id,
                  label: row.current?.tier ? `${row.current?.name || 'Unnamed organization'} (${row.current.tier})` : row.current?.name || 'Unnamed organization',
                })),
              ]}
              className="sm:max-w-[28rem]"
            />
            <div aria-live="polite">
              {prefillStatus ? <p className="text-admin-sm text-admin-ink-secondary">{prefillStatus}</p> : null}
            </div>
            <TextField help="Use the person or organization that should appear as the invoice recipient."
              label="Name to bill"
              value={form.billTo.name}
              onChange={(value) => setBillTo({ name: value })}
              error={errorFor('billTo.name')}
              maxLength={INVOICE_LIMITS.name}
              required
            />
            <TextField help="The person at the billed organization who handles this invoice. Leave blank if no contact is needed."
              label="Contact name"
              
              value={form.billTo.contactName}
              onChange={(value) => setBillTo({ contactName: value })}
              error={errorFor('billTo.contactName')}
              maxLength={INVOICE_LIMITS.contactName}
            />
            <TextField help="Optional. The invoice is sent to this address."
              hint="Optional. The invoice is sent to this address."
              label="Billing email"
              
              type="email"
              inputMode="email"
              autoComplete="off"
              value={form.billTo.email}
              onChange={(value) => setBillTo({ email: value })}
              error={errorFor('billTo.email')}
              maxLength={INVOICE_LIMITS.email}
              className="sm:max-w-[28rem]"
            />
            <TextAreaField help="Optional. One part of the address on each line."
              label="Billing address"
              
              rows={4}
              value={form.billTo.address}
              onChange={(value) => setBillTo({ address: value })}
              error={errorFor('billTo.address')}
              maxLength={INVOICE_LIMITS.address}
            />
            <TextField help="Optional. A purchase order number or the payer's own reference."
              label="Reference"
              
              value={form.reference}
              onChange={(value) => set({ reference: value })}
              error={errorFor('reference')}
              maxLength={INVOICE_LIMITS.reference}
              className="sm:max-w-[20rem]"
            />
          </div>
        </Panel>

        <Panel help="List the items or services being billed, with quantities and unit prices."
          title="Lines"
          description={`Up to ${INVOICE_LIMITS.lines} lines. Type prices in ${currency?.toUpperCase()}, such as 1250.00. A blank line is left out when you save.`}
        >
          <div className="flex flex-col gap-sm">
            <FieldErrorLine message={errorFor('lines')} />
            {form.lines.map((line, index) => (
              <fieldset aria-label={[(lineName(index)), " "].join('').trim()} key={line.key} className="flex min-w-0 flex-col gap-xs border-admin-rule-hairline border-b-admin-hairline pb-sm">
                <legend className="text-admin-base font-bold text-admin-ink">{lineName(index)} <HelpTooltip label={lineName(index)}>Describe this billed item and set its quantity and price.</HelpTooltip></legend>
                <TextField help="Describe the item or service as it should appear on the invoice."
                  label="Description"
                  value={line.description}
                  onChange={(value) => setLine(index, { description: value })}
                  error={errorFor(`lines.${index}.description`)}
                  maxLength={INVOICE_LIMITS.description}
                  data-row-focus={`lines.${index}`}
                  aria-label={`${lineName(index)} description`}
                />
                <div className="flex flex-wrap items-start gap-sm">
                  <TextField help="Enter how many units of this item you are billing for."
                    label="Quantity"
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(value) => setLine(index, { quantity: value })}
                    error={errorFor(`lines.${index}.quantity`)}
                    aria-label={`${lineName(index)} quantity`}
                    className="w-28"
                  />
                  <TextField help="Enter the price for one unit in the invoice’s currency."
                    label="Unit price"
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(value) => setLine(index, { unitPrice: value })}
                    error={errorFor(`lines.${index}.unitAmount`)}
                    aria-label={`${lineName(index)} unit price`}
                    className="w-40 font-admin-data tabular-nums"
                  />
                  <div className="flex flex-col gap-3xs">
                    <span className="text-admin-base font-semibold text-admin-ink">Amount</span>
                    <span className="flex min-h-admin-control items-center font-admin-data tabular-nums text-admin-ink">
                      {preview?.lineAmounts[index] == null ? 'Not counted yet' : money(preview.lineAmounts[index])}
                    </span>
                  </div>
                  <AdminIconControl label={`Remove ${lineName(index).toLowerCase()}`} icon="remove" className={linkButtonClass} onClick={() => removeLine(index)} />
                </div>
              </fieldset>
            ))}
            <div>
              <button
                type="button"
                className={secondaryButtonClass}
                data-row-focus="add-line"
                aria-disabled={atLineCap || undefined}
                onClick={addLine}
              >
                {atLineCap ? `Add a line (limit of ${INVOICE_LIMITS.lines} reached)` : 'Add a line'}
              </button>
            </div>
          </div>
        </Panel>

        <Panel help="Add any discounts or tax that change the invoice total."
          title="Discounts and tax"
          description={`Type each amount by hand. A discount subtracts and a tax adds. Up to ${INVOICE_LIMITS.adjustments} rows.`}
        >
          <div className="flex flex-col gap-sm">
            <FieldErrorLine message={errorFor('adjustments')} />
            {form.adjustments.map((row, index) => (
              <fieldset aria-label={[(adjustmentName(row, index)), " "].join('').trim()} key={row.key} className="flex min-w-0 flex-col gap-xs border-admin-rule-hairline border-b-admin-hairline pb-sm">
                <legend className="text-admin-base font-bold text-admin-ink">{adjustmentName(row, index)} <HelpTooltip label={adjustmentName(row, index)}>Name this discount or tax and set the amount it changes the total by.</HelpTooltip></legend>
                <div className="flex flex-wrap items-start gap-sm">
                  <SelectField help="Choose whether this adjustment adds to or subtracts from the invoice total."
                    label="Kind"
                    value={row.kind}
                    onChange={(value) => setAdjustment(index, { kind: value })}
                    options={[
                      { value: 'discount', label: 'Discount' },
                      { value: 'tax', label: 'Tax' },
                    ]}
                    data-row-focus={`adjustments.${index}`}
                    aria-label={`${adjustmentName(row, index)} kind`}
                  />
                  <TextField help="Name this adjustment as it should appear on the invoice."
                    label="Label"
                    value={row.label}
                    onChange={(value) => setAdjustment(index, { label: value })}
                    error={errorFor(`adjustments.${index}.label`)}
                    maxLength={INVOICE_LIMITS.label}
                    aria-label={`${adjustmentName(row, index)} label`}
                  />
                  <TextField help="Enter the value for this adjustment using its selected kind."
                    label="Amount"
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(value) => setAdjustment(index, { amount: value })}
                    error={errorFor(`adjustments.${index}.amount`)}
                    aria-label={`${adjustmentName(row, index)} amount`}
                    className="w-40 font-admin-data tabular-nums"
                  />
                  <AdminIconControl label={`Remove ${adjustmentName(row, index).toLowerCase()}`} icon="remove" className={linkButtonClass} onClick={() => removeAdjustment(index)} />
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-xs">
              <button
                type="button"
                className={secondaryButtonClass}
                data-row-focus="add-discount"
                aria-disabled={atAdjustmentCap || undefined}
                onClick={() => addAdjustment('discount')}
              >
                {atAdjustmentCap ? `Add a discount (limit of ${INVOICE_LIMITS.adjustments} rows reached)` : 'Add a discount'}
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                aria-disabled={atAdjustmentCap || undefined}
                onClick={() => addAdjustment('tax')}
              >
                {atAdjustmentCap ? `Add a tax (limit of ${INVOICE_LIMITS.adjustments} rows reached)` : 'Add a tax'}
              </button>
            </div>
          </div>
        </Panel>

        <Panel help="Review the total before issuing the invoice." title="Totals" description="Review the total before issuing the invoice.">
          {preview ? (
            <div className="flex flex-col gap-xs">
              <dl className="grid max-w-[28rem] grid-cols-[1fr_auto] gap-x-md gap-y-3xs text-admin-base">
                <dt className="text-admin-ink-secondary">Subtotal</dt>
                <dd className="text-end font-admin-data tabular-nums">{money(preview.subtotal)}</dd>
                <dt className="text-admin-ink-secondary">Discounts</dt>
                <dd className="text-end font-admin-data tabular-nums">{money(preview.discountTotal)}</dd>
                <dt className="text-admin-ink-secondary">Tax</dt>
                <dd className="text-end font-admin-data tabular-nums">{money(preview.taxTotal)}</dd>
              </dl>
              {/* The one sentence a screen reader hears after a change: the
                  total, and why a row is missing from it. */}
              <div aria-live="polite" aria-atomic="true" data-testid="invoice-total" className="flex flex-col gap-3xs">
                {preview.ok ? (
                  <p className="max-w-[28rem] border-admin-rule-strong border-t-admin-strong pt-2xs text-admin-lg font-bold">
                    Total: <span className="font-admin-data tabular-nums">{money(preview.total)}</span>
                  </p>
                ) : (
                  <p className="text-admin-sm font-medium text-admin-state-error">
                    {preview.problem === 'negative'
                      ? 'No total: The discounts take it below zero. Reduce a discount.'
                      : 'No total: An amount is too large.'}
                  </p>
                )}
                {preview.skipped > 0 ? (
                  <p className="text-admin-sm text-admin-state-caution">
                    {preview.skipped === 1
                      ? '1 row is not counted until its quantity and amount are numbers.'
                      : `${preview.skipped} rows are not counted until their quantities and amounts are numbers.`}
                  </p>
                ) : null}
              </div>
              <FieldErrorLine message={errorFor('totals')} />
            </div>
          ) : null}
        </Panel>

        <Panel help="Set the payment deadline and any notes printed on the invoice." title="Due date and notes">
          <div className="flex flex-col gap-sm">
            <TextField help="Optional. When payment is due."
              label="Due date"
              type="date"
              
              value={form.dueDate}
              onChange={(value) => set({ dueDate: value })}
              error={errorFor('dueDate')}
              className="sm:max-w-[16rem]"
            />
            <TextAreaField help="Optional. Printed under the lines, such as a thank-you or what the package includes."
              hint="Optional. Printed under the lines, such as a thank-you or what the package includes."
              label="Notes"
              
              rows={4}
              value={form.notes}
              onChange={(value) => set({ notes: value })}
              error={errorFor('notes')}
              maxLength={INVOICE_LIMITS.notes}
            />
          </div>
        </Panel>
      </fieldset>
  );
}

