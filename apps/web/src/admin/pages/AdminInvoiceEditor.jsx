// Invoice editor (issue #208): write and save one invoice draft.
//
// Save sends the draft to invoiceAdmin, which checks it with the same
// shared rules this page uses (shared/invoice) and computes every total
// again. The figures under the form are a preview of that arithmetic, in a
// polite live region, so a screen reader hears the new total after a change.
//
// ONE ID PER FORM. A new invoice's id is minted when the form opens and
// sent with every attempt, so a retry after a lost answer saves the same
// draft. Each save sends the revision the form was filled from; a save
// over a newer revision is refused, and the page says to reload.
//
// A draft has no number. Issue (#209) gives it the next number, freezes its
// totals and copies the issuer block, after a confirmation that names the
// next number. Issue sends the revision the form was filled from, so it
// issues the saved draft and never the unsaved form: with changes on the
// form, the page asks for a save first. After issue the fields sit in a
// disabled fieldset, and InvoiceRecord shows the frozen record with Mark
// paid, Duplicate and, for an operator, Void. Download PDF is in the
// header of every issued invoice.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { formatMoney } from 'shared/invoice';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { useAdminApi } from '../adminApi.js';
import { downloadInvoicePdf } from '../invoicePdf.js';
import InvoiceRecord from './InvoiceRecord.jsx';
import { useAdminContent } from '../useAdminContent.js';
import { useAdminOrganizations } from '../useAdminOrganizations.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import {
  ADJUSTMENT_WORDS,
  INVOICES_ROOT,
  INVOICE_LIMITS,
  INVOICE_STATUS_TONES,
  INVOICE_STATUS_WORDS,
  blankAdjustment,
  blankInvoiceForm,
  blankLine,
  formPathOf,
  formSnapshot,
  formToDraft,
  messageOf,
  mintInvoiceId,
  prefillFromOrganization,
  previewTotals,
  sponsorPackagesFrom,
  toInvoiceForm,
} from '../invoiceDoc.js';
import { UnsavedChangesDialog, UnsavedEditBadge } from '../components/UnsavedChanges.jsx';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';

/** "Line 2" — the name a row's fields and its remove control carry. */
function lineName(index) {
  return `Line ${index + 1}`;
}

function adjustmentName(row, index) {
  return `${ADJUSTMENT_WORDS[row.kind] ?? 'Row'} row ${index + 1}`;
}

export default function AdminInvoiceEditor({ mode }) {
  const params = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { user } = useAuth();
  const { eventConfig } = useEventConfig();
  const organizations = useAdminOrganizations();
  const content = useAdminContent();
  const packages = useMemo(() => sponsorPackagesFrom(content.rows), [content.rows]);

  const newIdRef = useRef(null);
  if (newIdRef.current === null) newIdRef.current = mintInvoiceId();
  const invoiceId = mode === 'create' ? newIdRef.current : params.invoiceId;

  // `loadedId` is the invoice the form was filled from. A create that has
  // just saved moves to the edit address with its own form still up, so it
  // does not load again over what the operator typed.
  const [loadedId, setLoadedId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [currency, setCurrency] = useState(null);
  const [form, setForm] = useState(blankInvoiceForm);
  const [saved, setSaved] = useState(() => formSnapshot(blankInvoiceForm()));
  const [revision, setRevision] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [rowFocus, setRowFocus] = useState(null);
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState('');
  const [prefillStatus, setPrefillStatus] = useState('');
  const [canVoid, setCanVoid] = useState(false);
  // The issue confirmation: null when closed, else { nextNumber, unsaved }.
  const [issueConfirm, setIssueConfirm] = useState(null);
  // A duplicate's new id, minted once per source so a retry after a lost
  // answer finds the same draft (the server answers it again).
  const duplicateIdRef = useRef(null);
  const formRef = useRef(null);
  const errorRef = useRef(null);
  const rowsRef = useRef({ lines: [], adjustments: [] });

  const loadKey = mode === 'create' ? 'create' : params.invoiceId;
  useEffect(() => {
    // Fill the form once per address. A new sign-in token gives a new
    // `call`, and loading again then would drop what the operator typed.
    if (mode === 'create' ? loadedId !== null : loadedId === params.invoiceId) return undefined;
    let active = true;
    setLoadError(null);
    const request = mode === 'create'
      ? call('invoiceAdmin', { action: 'settings' }).then((result) => {
        if (!active) return;
        const blank = blankInvoiceForm();
        setCurrency(result.invoiceCurrency);
        setInvoice(null);
        setForm(blank);
        setSaved(formSnapshot(blank));
        setRevision(0);
        setLoadedId('create');
      })
      : call('invoiceAdmin', { action: 'get', invoiceId: params.invoiceId }).then((result) => {
        if (!active) return;
        applyInvoice(result);
        setLoadedId(params.invoiceId);
      });
    request.catch((err) => {
      if (active) setLoadError(err);
    });
    return () => {
      active = false;
    };
    // loadedId is read as a guard only; a change to it must not load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, mode, loadKey]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  // A new address is a new invoice: no confirmation or copy id carries over.
  useEffect(() => {
    setIssueConfirm(null);
    duplicateIdRef.current = null;
  }, [invoiceId]);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(formRef.current);
  }, [focusRequest]);

  // Focus follows a row change: a new row's first field, or the row before
  // a removed one, or the add control when no row is left.
  useEffect(() => {
    if (!rowFocus) return;
    formRef.current?.querySelector(`[data-row-focus="${rowFocus}"]`)?.focus();
    setRowFocus(null);
  }, [rowFocus]);

  const locked = Boolean(invoice && invoice.status !== 'draft');
  const unsaved = !locked && formSnapshot(form) !== saved;
  const leaveGuard = useUnsavedNavigation(unsaved, { blocked: busy !== null });

  const localErrors = useMemo(
    () => (currency ? formToDraft(form, currency).errors : new Map()),
    [form, currency],
  );
  const serverErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (!segment.field) continue;
      const path = formPathOf(segment.field, rowsRef.current);
      if (!map.has(path)) map.set(path, messageOf(segment.message));
    }
    return map;
  }, [error]);
  const errorFor = (path) => (attempted ? localErrors.get(path) : undefined) ?? serverErrors.get(path);
  const preview = useMemo(() => (currency ? previewTotals(form, currency) : null), [form, currency]);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const setBillTo = (patch) => setForm((current) => ({ ...current, billTo: { ...current.billTo, ...patch } }));
  const setLine = (index, patch) => setForm((current) => ({
    ...current,
    lines: current.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)),
  }));
  const setAdjustment = (index, patch) => setForm((current) => ({
    ...current,
    adjustments: current.adjustments.map((row, at) => (at === index ? { ...row, ...patch } : row)),
  }));

  function addLine() {
    if (form.lines.length >= INVOICE_LIMITS.lines) return;
    setForm((current) => ({ ...current, lines: [...current.lines, blankLine()] }));
    setRowFocus(`lines.${form.lines.length}`);
  }
  function removeLine(index) {
    setForm((current) => ({ ...current, lines: current.lines.filter((_, at) => at !== index) }));
    setRowFocus(index > 0 ? `lines.${index - 1}` : form.lines.length > 1 ? 'lines.0' : 'add-line');
  }
  function addAdjustment(kind) {
    if (form.adjustments.length >= INVOICE_LIMITS.adjustments) return;
    setForm((current) => ({ ...current, adjustments: [...current.adjustments, blankAdjustment(kind)] }));
    setRowFocus(`adjustments.${form.adjustments.length}`);
  }
  function removeAdjustment(index) {
    setForm((current) => ({ ...current, adjustments: current.adjustments.filter((_, at) => at !== index) }));
    setRowFocus(index > 0 ? `adjustments.${index - 1}` : form.adjustments.length > 1 ? 'adjustments.0' : 'add-discount');
  }

  function chooseOrganization(id) {
    const organization = id ? organizations.findRow(id) : null;
    const { form: next, filled } = prefillFromOrganization(form, organization, packages, currency);
    setForm(next);
    setPrefillStatus(filled);
  }

  async function save() {
    if (busy || locked || !currency) return;
    setAttempted(true);
    const { draft, errors, rows } = formToDraft(form, currency);
    // The save control stays enabled while a field is invalid: pressing it
    // moves the keyboard to the field that stopped it and sends nothing.
    if (errors.size > 0) {
      setFocusRequest((count) => count + 1);
      return;
    }
    rowsRef.current = rows;
    setBusy('save');
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    try {
      const result = await call('invoiceAdmin', {
        action: 'saveDraft', invoiceId, expectedRevision: revision, invoice: draft,
      });
      applyInvoice(result);
      setAttempted(false);
      setIssueConfirm(null);
      const message = 'Draft saved. It has no number until it is issued.';
      setStatus(message);
      // The status line is the record and it announces; the toast repeats
      // it and says nothing.
      showToast(message, { announce: false });
      if (mode === 'create') {
        setLoadedId(invoiceId);
        navigate(`${INVOICES_ROOT}/${encodeURIComponent(invoiceId)}`, { replace: true });
      }
    } catch (err) {
      if (err?.code === 'conflict') setErrorTitle('The invoice was not saved');
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function reload() {
    setError(null);
    setErrorTitle(undefined);
    setLoadedId(null);
    try {
      const result = await call('invoiceAdmin', { action: 'get', invoiceId });
      applyInvoice(result);
      setLoadedId(invoiceId);
      setStatus('Reloaded the saved invoice. Your unsaved changes were discarded.');
      // A new form whose first answer was lost: the server saved the draft
      // under this form's id, so the retry met its own save as a conflict.
      // The draft now opens at its own address, as an edit.
      if (mode === 'create') navigate(`${INVOICES_ROOT}/${encodeURIComponent(invoiceId)}`, { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  /** Fill the page from an endpoint answer: `{ invoice, canVoid }`. */
  function applyInvoice(result) {
    const filled = toInvoiceForm(result.invoice);
    setInvoice(result.invoice);
    setCurrency(result.invoice.currency);
    setForm(filled);
    setSaved(formSnapshot(filled));
    setRevision(result.invoice.revision);
    setCanVoid(result.canVoid === true);
  }

  function clearError() {
    setError(null);
    setErrorTitle(undefined);
  }

  /** Open the confirmation. It names the next number, read from the settings. */
  async function openIssue() {
    if (busy) return;
    clearError();
    if (unsaved) {
      setIssueConfirm({ unsaved: true, nextNumber: null });
      return;
    }
    setIssueConfirm({ unsaved: false, nextNumber: null });
    try {
      const settings = await call('invoiceAdmin', { action: 'settings' });
      setIssueConfirm((current) => (current && !current.unsaved ? { ...current, nextNumber: settings.nextNumber } : current));
    } catch {
      // The preview is a courtesy; the server assigns the number at issue.
    }
  }

  async function issue() {
    if (busy) return;
    // The form changed after the confirmation opened: issue would send the
    // saved revision, not what is on screen, so ask for a save instead.
    if (unsaved) {
      setIssueConfirm({ unsaved: true, nextNumber: null });
      return;
    }
    setBusy('issue');
    clearError();
    setStatus('');
    try {
      const result = await call('invoiceAdmin', { action: 'issue', invoiceId, expectedRevision: revision });
      applyInvoice(result);
      setIssueConfirm(null);
      const message = `Issued as ${result.invoice.number}. Its details are now locked.`;
      setStatus(message);
      showToast(message, { announce: false });
    } catch (err) {
      setIssueConfirm(null);
      setErrorTitle('The invoice was not issued');
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  /** InvoiceRecord's forms state their own refusals, so these rethrow. */
  async function markPaid(payment) {
    setBusy('paid');
    clearError();
    setStatus('');
    try {
      const result = await call('invoiceAdmin', { action: 'markPaid', invoiceId, expectedRevision: revision, payment });
      applyInvoice(result);
      const message = `Marked ${result.invoice.number} paid.`;
      setStatus(message);
      showToast(message, { announce: false });
    } finally {
      setBusy(null);
    }
  }

  async function voidInvoice(reason) {
    setBusy('void');
    clearError();
    setStatus('');
    try {
      const result = await call('invoiceAdmin', { action: 'void', invoiceId, expectedRevision: revision, reason });
      applyInvoice(result);
      const message = `Voided ${result.invoice.number}.`;
      setStatus(message);
      showToast(message, { announce: false });
    } finally {
      setBusy(null);
    }
  }

  async function duplicate() {
    if (busy) return;
    if (duplicateIdRef.current === null) duplicateIdRef.current = mintInvoiceId();
    const newInvoiceId = duplicateIdRef.current;
    setBusy('duplicate');
    clearError();
    setStatus('');
    try {
      const result = await call('invoiceAdmin', { action: 'duplicate', invoiceId, newInvoiceId });
      const from = invoice?.number ?? 'the invoice';
      applyInvoice(result);
      setLoadedId(newInvoiceId);
      const message = `Copied ${from} into a new draft. It has no number until it is issued.`;
      setStatus(message);
      showToast(message, { announce: false });
      navigate(`${INVOICES_ROOT}/${encodeURIComponent(newInvoiceId)}`);
    } catch (err) {
      setErrorTitle('The invoice was not copied');
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    if (busy) return;
    setBusy('pdf');
    clearError();
    try {
      await downloadInvoicePdf({ getIdToken: () => user.getIdToken(), invoiceId, number: invoice.number });
      setStatus(`Downloaded ${invoice.number}.pdf.`);
    } catch (err) {
      setErrorTitle('The PDF was not downloaded');
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setError(null);
    setErrorTitle(undefined);
    try {
      await call('invoiceAdmin', { action: 'deleteDraft', invoiceId, expectedRevision: revision });
      setSaved(formSnapshot(form));
      showToast('Draft deleted.');
      navigate(INVOICES_ROOT);
    } catch (err) {
      setErrorTitle('The draft was not deleted');
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return loadError.status === 404 ? (
      <AdminEmptyState
        title="No such invoice"
        description="That invoice does not exist. It may have been deleted."
        action={<Link to={INVOICES_ROOT} className={secondaryButtonClass}>Go to invoices</Link>}
      />
    ) : (
      <ServerErrorSummary error={loadError} title="The invoice could not be loaded" />
    );
  }
  // A create that has saved holds its own id until the address catches up.
  if (loadedId !== invoiceId && !(mode === 'create' && loadedId === 'create')) {
    return <AdminLoadingState label="Loading invoice…" />;
  }

  const statusWord = INVOICE_STATUS_WORDS[invoice?.status ?? 'draft'];
  const title = mode === 'create'
    ? 'New invoice'
    : invoice?.number ?? `Draft for ${invoice?.billTo?.name || 'no name yet'}`;
  const timeZone = eventConfig?.timezone;
  const money = (amount) => formatMoney(amount, currency);
  const atLineCap = form.lines.length >= INVOICE_LIMITS.lines;
  const atAdjustmentCap = form.adjustments.length >= INVOICE_LIMITS.adjustments;

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
        title={title}
        state={
          <>
            <StatusBadge tone={INVOICE_STATUS_TONES[invoice?.status ?? 'draft']} data-invoice-status={invoice?.status ?? 'draft'}>
              {statusWord}
            </StatusBadge>
            {unsaved ? <UnsavedEditBadge /> : null}
          </>
        }
        identifiers={mode === 'edit' ? `${invoiceId} · ${currency?.toUpperCase()}` : currency?.toUpperCase()}
        description="Save keeps a draft. The server checks every line and computes the totals again."
        actions={
          locked ? (
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={busy !== null}
              aria-busy={busy === 'pdf' || undefined}
              onClick={downloadPdf}
            >
              {busy === 'pdf' ? 'Downloading…' : 'Download PDF'}
            </button>
          ) : (
            <>
              {mode === 'edit' ? (
                <button type="button" className={secondaryButtonClass} disabled={busy !== null} onClick={openIssue}>
                  Issue invoice
                </button>
              ) : null}
              <button
                type="submit"
                className={primaryButtonClass}
                disabled={busy !== null}
                aria-busy={busy === 'save' || undefined}
              >
                {busy === 'save' ? 'Saving…' : 'Save draft'}
              </button>
            </>
          )
        }
      />

      {issueConfirm && !locked ? (
        <IssueConfirm
          key={issueConfirm.unsaved ? 'unsaved' : 'ready'}
          confirm={issueConfirm}
          busy={busy === 'issue'}
          onIssue={issue}
          onCancel={() => setIssueConfirm(null)}
        />
      ) : null}

      {locked ? (
        <Notice tone="info" message={`This invoice is ${statusWord.toLowerCase()}. Its details cannot change.`} />
      ) : null}
      {!locked && invoice?.duplicatedFrom ? (
        <Notice tone="info">
          {'Copied from '}
          <Link to={`${INVOICES_ROOT}/${encodeURIComponent(invoice.duplicatedFrom.invoiceId)}`} className="underline">
            {invoice.duplicatedFrom.number ?? 'an earlier invoice'}
          </Link>
          {'. Check every line and the due date, then save and issue it.'}
        </Notice>
      ) : null}

      <ServerErrorSummary error={error} errorRef={errorRef} title={errorTitle} />
      {error?.code === 'conflict' ? (
        <div>
          <button type="button" className={secondaryButtonClass} onClick={reload}>
            Reload the saved invoice
          </button>
        </div>
      ) : null}
      {status ? <SaveStatus message={status} /> : null}
      {leaveGuard.pending ? createPortal(
        <UnsavedChangesDialog
          onStay={leaveGuard.stay}
          onDiscard={leaveGuard.discard}
          canDiscard={leaveGuard.canDiscard}
        />,
        document.body,
      ) : null}

      {locked ? (
        <InvoiceRecord
          invoice={invoice}
          canVoid={canVoid}
          timeZone={timeZone}
          busy={busy}
          onMarkPaid={markPaid}
          onVoid={voidInvoice}
          onDuplicate={duplicate}
        />
      ) : null}

      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-md">
        <legend className="sr-only">Invoice details</legend>
        <Panel title="Bill to" description="Who pays this invoice. Choose an organization to fill the name and its sponsor package.">
          <div className="flex flex-col gap-sm">
            <SelectField
              label="Organization"
              hint={organizations.loading ? 'Loading organizations…' : 'Optional. The name and the first line can still be edited.'}
              value={form.organizationId}
              onChange={chooseOrganization}
              options={[
                { value: '', label: 'No organization' },
                ...organizations.rows.map((row) => ({
                  value: row.id,
                  label: row.current?.tier ? `${row.current?.name || row.id} (${row.current.tier})` : row.current?.name || row.id,
                })),
              ]}
              className="sm:max-w-[28rem]"
            />
            <div aria-live="polite">
              {prefillStatus ? <p className="text-admin-sm text-admin-ink-secondary">{prefillStatus}</p> : null}
            </div>
            <TextField
              label="Name to bill"
              value={form.billTo.name}
              onChange={(value) => setBillTo({ name: value })}
              error={errorFor('billTo.name')}
              maxLength={INVOICE_LIMITS.name}
              required
            />
            <TextField
              label="Contact name"
              hint="Optional."
              value={form.billTo.contactName}
              onChange={(value) => setBillTo({ contactName: value })}
              error={errorFor('billTo.contactName')}
              maxLength={INVOICE_LIMITS.contactName}
            />
            <TextField
              label="Billing email"
              hint="Optional. The invoice is sent to this address."
              type="email"
              inputMode="email"
              autoComplete="off"
              value={form.billTo.email}
              onChange={(value) => setBillTo({ email: value })}
              error={errorFor('billTo.email')}
              maxLength={INVOICE_LIMITS.email}
              className="sm:max-w-[28rem]"
            />
            <TextAreaField
              label="Billing address"
              hint="Optional. One part of the address on each line."
              rows={4}
              value={form.billTo.address}
              onChange={(value) => setBillTo({ address: value })}
              error={errorFor('billTo.address')}
              maxLength={INVOICE_LIMITS.address}
            />
            <TextField
              label="Reference"
              hint="Optional. A purchase order number or the payer's own reference."
              value={form.reference}
              onChange={(value) => set({ reference: value })}
              error={errorFor('reference')}
              maxLength={INVOICE_LIMITS.reference}
              className="sm:max-w-[20rem]"
            />
          </div>
        </Panel>

        <Panel
          title="Lines"
          description={`Up to ${INVOICE_LIMITS.lines} lines. Type prices in ${currency?.toUpperCase()}, such as 1250.00. A blank line is left out when you save.`}
        >
          <div className="flex flex-col gap-sm">
            <FieldErrorLine message={errorFor('lines')} />
            {form.lines.map((line, index) => (
              <fieldset key={line.key} className="flex min-w-0 flex-col gap-xs border-admin-rule-hairline border-b-admin-hairline pb-sm">
                <legend className="text-admin-base font-bold text-admin-ink">{lineName(index)}</legend>
                <TextField
                  label="Description"
                  value={line.description}
                  onChange={(value) => setLine(index, { description: value })}
                  error={errorFor(`lines.${index}.description`)}
                  maxLength={INVOICE_LIMITS.description}
                  data-row-focus={`lines.${index}`}
                  aria-label={`${lineName(index)} description`}
                />
                <div className="flex flex-wrap items-start gap-sm">
                  <TextField
                    label="Quantity"
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(value) => setLine(index, { quantity: value })}
                    error={errorFor(`lines.${index}.quantity`)}
                    aria-label={`${lineName(index)} quantity`}
                    className="w-28"
                  />
                  <TextField
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
                  <button
                    type="button"
                    className={`${linkButtonClass} self-end`}
                    onClick={() => removeLine(index)}
                  >
                    Remove {lineName(index).toLowerCase()}
                  </button>
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

        <Panel
          title="Discounts and tax"
          description={`Type each amount by hand. A discount subtracts and a tax adds. Up to ${INVOICE_LIMITS.adjustments} rows.`}
        >
          <div className="flex flex-col gap-sm">
            <FieldErrorLine message={errorFor('adjustments')} />
            {form.adjustments.map((row, index) => (
              <fieldset key={row.key} className="flex min-w-0 flex-col gap-xs border-admin-rule-hairline border-b-admin-hairline pb-sm">
                <legend className="text-admin-base font-bold text-admin-ink">{adjustmentName(row, index)}</legend>
                <div className="flex flex-wrap items-start gap-sm">
                  <SelectField
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
                  <TextField
                    label="Label"
                    value={row.label}
                    onChange={(value) => setAdjustment(index, { label: value })}
                    error={errorFor(`adjustments.${index}.label`)}
                    maxLength={INVOICE_LIMITS.label}
                    aria-label={`${adjustmentName(row, index)} label`}
                  />
                  <TextField
                    label="Amount"
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(value) => setAdjustment(index, { amount: value })}
                    error={errorFor(`adjustments.${index}.amount`)}
                    aria-label={`${adjustmentName(row, index)} amount`}
                    className="w-40 font-admin-data tabular-nums"
                  />
                  <button
                    type="button"
                    className={`${linkButtonClass} self-end`}
                    onClick={() => removeAdjustment(index)}
                  >
                    Remove {adjustmentName(row, index).toLowerCase()}
                  </button>
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

        <Panel title="Totals" description="A preview. The server computes the same figures when you save.">
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

        <Panel title="Due date and notes">
          <div className="flex flex-col gap-sm">
            <TextField
              label="Due date"
              type="date"
              hint={`Optional. A date on the event's clock${timeZone ? ` (${timeZone})` : ''}.`}
              value={form.dueDate}
              onChange={(value) => set({ dueDate: value })}
              error={errorFor('dueDate')}
              className="sm:max-w-[16rem]"
            />
            <TextAreaField
              label="Notes"
              hint="Optional. Printed under the lines, such as a thank-you or what the package includes."
              rows={4}
              value={form.notes}
              onChange={(value) => set({ notes: value })}
              error={errorFor('notes')}
              maxLength={INVOICE_LIMITS.notes}
            />
          </div>
        </Panel>
      </fieldset>

      <div className="flex flex-wrap items-center gap-xs">
        <Link to={INVOICES_ROOT} className={secondaryButtonClass}>
          Back to invoices
        </Link>
        {mode === 'edit' && !locked ? (
          <DestructiveConfirm
            className="ms-auto"
            trigger="Delete this draft"
            confirmLabel="Delete this draft"
            busyLabel="Deleting…"
            busy={busy === 'delete'}
            consequence="The draft and its lines are removed. A draft has no number, so no number is lost."
            permanence="This cannot be undone."
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
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

/**
 * The issue confirmation. Issuing is not destructive, so it is not on the
 * alarm ground, but it cannot be undone: it names the number and says what
 * locks. With unsaved changes it asks for a save and offers no issue.
 */
function IssueConfirm({ confirm, busy, onIssue, onCancel }) {
  const headingId = useId();
  const sectionRef = useRef(null);
  useEffect(() => {
    sectionRef.current?.focus();
  }, []);
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex flex-col gap-xs rounded-admin-panel border-admin-hairline border-admin-rule-strong bg-admin-ground-raised px-md py-sm"
    >
      <h2 id={headingId} className="text-admin-base font-bold text-admin-ink">Issue this invoice?</h2>
      {confirm.unsaved ? (
        <>
          <p className="max-w-[65ch] text-admin-sm text-admin-ink">Save the draft first. Issue uses the saved draft, not the form.</p>
          <div>
            <button type="button" className={secondaryButtonClass} onClick={onCancel}>Keep editing</button>
          </div>
        </>
      ) : (
        <>
          <p className="max-w-[65ch] text-admin-sm text-admin-ink">
            {confirm.nextNumber ? `The next number is ${confirm.nextNumber}. ` : 'It takes the next invoice number. '}
            Issue gives the invoice its number and today's date, and copies the invoice settings onto it. Its details then cannot change. To correct it later, an operator voids it and you duplicate it.
          </p>
          <div className="flex flex-wrap items-center gap-xs">
            <button type="button" className={primaryButtonClass} disabled={busy} aria-busy={busy || undefined} onClick={onIssue}>
              {busy ? 'Issuing…' : 'Issue this invoice'}
            </button>
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}
