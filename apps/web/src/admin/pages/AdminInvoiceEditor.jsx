import HelpTooltip from '../components/HelpTooltip.jsx';
import { plannerError } from '../plannerErrors.js';
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
// form, the page asks for a save first. After issue InvoiceRecord shows the
// frozen billing details, lines, totals and the actions: Email
// invoice (an issued or paid one), Mark paid, Duplicate and, for an
// operator, Void and Reopen (a paid invoice). Download PDF is in the header
// of every issued invoice.
import AdminIconControl from '../components/AdminIconControl.jsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { useAdminApi } from '../adminApi.js';
import { downloadInvoicePdf } from '../invoicePdf.js';
import InvoiceRecord from './InvoiceRecord.jsx';
import InvoiceDetailsFields from '../components/InvoiceDetailsFields.jsx';
import { useAdminContent } from '../useAdminContent.js';
import { useAdminOrganizations } from '../useAdminOrganizations.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import {
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
  SaveStatus,
  ServerErrorSummary,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';

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
  const [canReopen, setCanReopen] = useState(false);
  // Whether this site makes Stripe card links (#519), from the server's answer.
  const [cardPayments, setCardPayments] = useState(null);
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
      setError(plannerError(err));
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
      setError(plannerError(err));
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
    setCanReopen(result.canReopen === true);
    setCardPayments(result.cardPayments ?? null);
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
      setError(plannerError(err));
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

  async function reopenInvoice(reason) {
    setBusy('reopen');
    clearError();
    setStatus('');
    try {
      const result = await call('invoiceAdmin', { action: 'reopen', invoiceId, expectedRevision: revision, reason });
      applyInvoice(result);
      const message = `Reopened ${result.invoice.number}. The payment is kept under Earlier payments.`;
      setStatus(message);
      showToast(message, { announce: false });
    } finally {
      setBusy(null);
    }
  }

  /** A Stripe card link (#519). The panel states a refusal in place, so this rethrows. */
  async function createPayLink() {
    setBusy('paylink');
    clearError();
    setStatus('');
    try {
      const result = await call('invoiceAdmin', { action: 'createPayLink', invoiceId });
      applyInvoice(result);
      const message = result.repeated
        ? `The card payment link for ${result.invoice.number} is still open.`
        : `Made a card payment link for ${result.invoice.number}.`;
      setStatus(message);
      showToast(message, { announce: false });
    } finally {
      setBusy(null);
    }
  }

  async function resolveReview(reviewId, note) {
    setBusy('review');
    clearError();
    setStatus('');
    try {
      const result = await call('invoiceAdmin', { action: 'resolvePaymentReview', invoiceId, reviewId, note });
      applyInvoice(result);
      const message = `Marked the card payment on ${result.invoice.number} reviewed.`;
      setStatus(message);
      showToast(message, { announce: false });
    } finally {
      setBusy(null);
    }
  }

  /** The email preview (part 4). The form states a refusal in place, so this rethrows. */
  async function previewEmail(input) {
    clearError();
    return call('invoiceAdmin', { action: 'previewSend', invoiceId, ...input });
  }

  async function sendEmail(input) {
    setBusy('email');
    clearError();
    setStatus('');
    try {
      const result = await call('invoiceAdmin', { action: 'send', invoiceId, ...input });
      applyInvoice(result);
      const copy = input.cc ? `, with a copy to ${input.cc}` : '';
      const to = result.invoice.billTo?.email ?? 'the billing email';
      const message = result.outcome === 'uncertain'
        ? `The email provider did not confirm the email of ${result.invoice.number}. It may have been sent. Check the email log before you send it again.`
        : `Emailed ${result.invoice.number} to ${to}${copy}.`;
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
      setError(plannerError(err));
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
      setError(plannerError(err));
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
      setError(plannerError(err));
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

  // The server sends 'unknown' for a status it does not know; it is locked like an issued one.
  const statusWord = INVOICE_STATUS_WORDS[invoice?.status ?? 'draft'] ?? 'Unknown';
  const title = mode === 'create'
    ? 'New invoice'
    : invoice?.number ?? `Draft for ${invoice?.billTo?.name || 'no name yet'}`;
  const timeZone = eventConfig?.timezone;

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
      <AdminPageHeader help="Prepare an invoice for a sponsor or partner."
        title={title}
        state={
          <>
            <StatusBadge tone={INVOICE_STATUS_TONES[invoice?.status ?? 'draft']} data-invoice-status={invoice?.status ?? 'draft'}>
              {statusWord}
            </StatusBadge>
            {unsaved ? <UnsavedEditBadge /> : null}
          </>
        }
        identifiers={currency?.toUpperCase()}
        description="Prepare an invoice for a sponsor or partner."
        actions={
          locked ? (
            <AdminIconControl label="Download PDF" icon="download" busy={busy === 'pdf'} className={secondaryButtonClass} disabled={busy !== null} aria-busy={busy === 'pdf' || undefined} onClick={downloadPdf} />
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
                {busy === 'save' ? 'Saving…' : 'Save'}
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
          canReopen={canReopen}
          timeZone={timeZone}
          busy={busy}
          onMarkPaid={markPaid}
          onVoid={voidInvoice}
          onReopen={reopenInvoice}
          onDuplicate={duplicate}
          onPreviewEmail={previewEmail}
          onSendEmail={sendEmail}
          cardPayments={cardPayments}
          onCreatePayLink={createPayLink}
          onResolveReview={resolveReview}
        />
      ) : null}

      {!locked ? <InvoiceDetailsFields
        form={form} currency={currency} organizations={organizations} prefillStatus={prefillStatus}
        busy={busy} preview={preview} errorFor={errorFor} chooseOrganization={chooseOrganization}
        setBillTo={setBillTo} set={set} setLine={setLine} removeLine={removeLine} addLine={addLine}
        setAdjustment={setAdjustment} removeAdjustment={removeAdjustment} addAdjustment={addAdjustment}
      /> : null}

      <div className="flex flex-wrap items-center gap-xs">
        <Link to={INVOICES_ROOT} className={secondaryButtonClass}>
          Back to invoices
        </Link>
        {mode === 'edit' && !locked ? (
          <DestructiveConfirm
            className="ms-auto"
            trigger="Delete this draft"
            triggerIcon="delete"
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
      <div className="flex items-center gap-2xs"><h2 id={headingId} className="text-admin-base font-bold text-admin-ink">Issue this invoice?</h2><HelpTooltip label="Issue this invoice?">Issuing assigns an invoice number and fixes the billed details. Review the total and recipient before continuing.</HelpTooltip></div>
      {confirm.unsaved ? (
        <>
          <p className="text-admin-sm text-admin-ink">Save your changes before issuing this invoice.</p>
          <div>
            <button type="button" className={secondaryButtonClass} onClick={onCancel}>Keep editing</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-admin-sm text-admin-ink">
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
