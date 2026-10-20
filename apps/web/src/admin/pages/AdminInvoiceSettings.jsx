// Invoice settings (issue #208): the issuer block, payment instructions and
// number prefix every issued invoice copies.
//
// Staff open this page to see what an invoice will carry; only an operator
// changes it, because it holds the bank details (the approved spec). The
// server says which one the reader is (`canEdit`), and refuses a save from
// staff whatever this page shows. The settings live in invoice_settings,
// not in config/event, which anyone can read.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { INVOICE_LIMITS, formatInvoiceNumber, validateInvoiceSettings } from 'shared/invoice';
import { useToast } from '../../contexts/ToastContext.jsx';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { useAdminApi } from '../adminApi.js';
import { CURRENCY_CHOICES, INVOICES_ROOT, messageOf } from '../invoiceDoc.js';
import {
  Notice,
  Panel,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { AdminLoadingState } from '../components/adminChrome.jsx';

const FIELDS = Object.freeze(['prefix', 'currency', 'issuerName', 'issuerAddress', 'issuerEmail', 'taxId', 'paymentInstructions']);

function formOf(settings) {
  return Object.fromEntries(FIELDS.map((key) => [key, settings?.[key] ?? '']));
}

/** "Invoices use GBP, the ticket catalog's currency." */
export function currencySentence({ invoiceCurrency, catalogCurrency }) {
  const code = String(invoiceCurrency ?? 'usd').toUpperCase();
  if (catalogCurrency && catalogCurrency === invoiceCurrency) {
    return `New invoices use ${code}, the ticket catalog's currency. The currency below is used only when there is no ticket catalog.`;
  }
  return `New invoices use ${code}. A ticket catalog's currency takes the place of this one.`;
}

export default function AdminInvoiceSettings() {
  const call = useAdminApi();
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(formOf(null));
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef(null);
  const errorRef = useRef(null);

  // Loaded once. A new sign-in token gives a new `call`, and loading again
  // then would drop what the operator typed.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return undefined;
    let active = true;
    call('invoiceAdmin', { action: 'settings' })
      .then((result) => {
        if (!active) return;
        loadedRef.current = true;
        setData(result);
        setForm(formOf(result.settings));
      })
      .catch((err) => {
        if (active) setLoadError(err);
      });
    return () => {
      active = false;
    };
  }, [call]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (focusRequest > 0) focusFirstError(formRef.current);
  }, [focusRequest]);

  if (loadError) return <ServerErrorSummary error={loadError} title="The invoice settings could not be loaded" />;
  if (!data) return <AdminLoadingState label="Loading invoice settings…" />;

  const canEdit = data.canEdit === true;
  const verdict = validateInvoiceSettings(form);
  const localErrors = new Map(verdict.issues.map((issue) => [issue.path, issue.message]));
  const serverErrors = new Map(
    (error?.fieldErrors ?? []).filter((segment) => segment.field).map((segment) => [segment.field, messageOf(segment.message)]),
  );
  const errorFor = (field) => (attempted ? localErrors.get(field) : undefined) ?? serverErrors.get(field);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const prefixPreview = /^[A-Z][A-Z0-9-]{0,9}$/.test(form.prefix.trim() || 'INV')
    ? formatInvoiceNumber(form.prefix.trim() || 'INV', 1)
    : null;

  async function save() {
    if (saving || !canEdit) return;
    setAttempted(true);
    if (!verdict.ok) {
      setFocusRequest((count) => count + 1);
      return;
    }
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      const result = await call('invoiceAdmin', { action: 'saveSettings', expectedRevision: data.revision, settings: form });
      setData(result);
      setForm(formOf(result.settings));
      setAttempted(false);
      const message = 'Invoice settings saved. Invoices issued from now on use them.';
      setStatus(message);
      showToast(message, { announce: false });
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      ref={formRef}
      noValidate
      className="flex flex-col gap-md"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <AdminPageHeader
        title="Invoice settings"
        identifiers={`Next number ${data.nextNumber}`}
        description="What every issued invoice copies: who it is from, how to pay, and how it is numbered. An issued invoice keeps the settings it was issued with."
        actions={
          <>
            <Link to={INVOICES_ROOT} className={secondaryButtonClass}>
              Back to invoices
            </Link>
            {canEdit ? (
              <button type="submit" className={primaryButtonClass} disabled={saving} aria-busy={saving || undefined}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            ) : null}
          </>
        }
      />

      {canEdit ? null : (
        <Notice tone="info" message="Only an operator can change these settings, because they hold the bank details. Ask an operator if something here is wrong." />
      )}
      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Numbering and currency">
        <div className="flex flex-col gap-sm">
          <TextField
            label="Number prefix"
            hint={`Capital letters, digits or hyphens, up to 10. Numbers run without gaps from 0001${prefixPreview ? `. The first is ${prefixPreview}` : ''}.`}
            value={form.prefix}
            onChange={(value) => set({ prefix: value.toUpperCase() })}
            error={errorFor('prefix')}
            maxLength={10}
            readOnly={!canEdit}
            autoCapitalize="characters"
            className="font-admin-data sm:max-w-[12rem]"
          />
          <SelectField
            label="Currency"
            hint={currencySentence(data)}
            value={form.currency}
            onChange={(value) => set({ currency: value })}
            error={errorFor('currency')}
            disabled={!canEdit}
            options={[
              { value: '', label: 'US dollar (USD), the default' },
              ...CURRENCY_CHOICES.map((code) => ({ value: code, label: code.toUpperCase() })),
            ]}
            className="sm:max-w-[20rem]"
          />
        </div>
      </Panel>

      <Panel title="Issuer" description="Printed at the head of every invoice.">
        <div className="flex flex-col gap-sm">
          <TextField
            label="Issuer name"
            value={form.issuerName}
            onChange={(value) => set({ issuerName: value })}
            error={errorFor('issuerName')}
            maxLength={INVOICE_LIMITS.issuerName}
            readOnly={!canEdit}
          />
          <TextAreaField
            label="Issuer address"
            hint="One part of the address on each line."
            rows={4}
            value={form.issuerAddress}
            onChange={(value) => set({ issuerAddress: value })}
            error={errorFor('issuerAddress')}
            maxLength={INVOICE_LIMITS.issuerAddress}
            readOnly={!canEdit}
          />
          <TextField
            label="Issuer email"
            type="email"
            inputMode="email"
            value={form.issuerEmail}
            onChange={(value) => set({ issuerEmail: value })}
            error={errorFor('issuerEmail')}
            maxLength={INVOICE_LIMITS.email}
            readOnly={!canEdit}
            className="sm:max-w-[28rem]"
          />
          <TextField
            label="Tax ID"
            hint="Optional. The issuer's tax or VAT number."
            value={form.taxId}
            onChange={(value) => set({ taxId: value })}
            error={errorFor('taxId')}
            maxLength={INVOICE_LIMITS.taxId}
            readOnly={!canEdit}
            className="font-admin-data sm:max-w-[20rem]"
          />
        </div>
      </Panel>

      <Panel title="Payment instructions" description="Printed under the totals. Bank transfer details, a check address, or both.">
        <TextAreaField
          label="Payment instructions"
          rows={6}
          value={form.paymentInstructions}
          onChange={(value) => set({ paymentInstructions: value })}
          error={errorFor('paymentInstructions')}
          maxLength={INVOICE_LIMITS.paymentInstructions}
          readOnly={!canEdit}
        />
      </Panel>
    </form>
  );
}
