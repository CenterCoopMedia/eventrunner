// The record of an issued invoice (issue #209), and what staff can do with
// it: mark it paid, duplicate it into a new draft, and, for an operator,
// void it or reopen a paid one.
//
// Everything here is the server's frozen copy: the number, the issue date
// and the issuer block were fixed at issue, so later settings edits do not
// show. The page above (AdminInvoiceEditor) owns the calls; this component
// owns the two small forms and states their refusals in place.
//
// The forms sit inside the editor's <form>, so their controls are plain
// buttons. A press with a field the rules refuse moves focus to that field
// and sends nothing, like every admin form.
import { useEffect, useId, useRef, useState } from 'react';
import {
  INVOICE_LIMITS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_WORDS,
  invoiceDateIn,
  validatePayment,
  validateReopenReason,
  validateVoidReason,
} from 'shared/invoice';
import {
  ServerErrorSummary,
  SelectField,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import { messageOf } from '../invoiceDoc.js';
import { focusFirstError } from '../../lib/focusFirstError.js';

const panelClass = 'admin-panel min-w-0 rounded-admin-panel border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-md';
const termClass = 'text-admin-ink-secondary';
const valueClass = 'min-w-0 whitespace-pre-line break-words';

/** The issues a validator or the server named, keyed by field path. */
function issuesByPath(issues) {
  const map = new Map();
  for (const issue of issues ?? []) {
    if (issue.path && !map.has(issue.path)) map.set(issue.path, issue.message);
  }
  return map;
}

function fieldErrorsOf(error) {
  return issuesByPath((error?.fieldErrors ?? []).map((segment) => ({ path: segment.field, message: messageOf(segment.message) })));
}

function Row({ term, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <>
      <dt className={termClass}>{term}</dt>
      <dd className={valueClass}>{children}</dd>
    </>
  );
}

/** Mark paid: the date it arrived, how, and an optional note. */
function MarkPaidForm({ timeZone, busy, onSubmit, onCancel }) {
  const headingId = useId();
  const sectionRef = useRef(null);
  const [payment, setPayment] = useState(() => ({ paidOn: invoiceDateIn(new Date(), timeZone), method: 'bank-transfer', note: '' }));
  const [errors, setErrors] = useState(new Map());
  const [serverError, setServerError] = useState(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(sectionRef.current);
  }, [focusRequest]);

  // The button that opened the form is gone, so the keyboard starts here.
  useEffect(() => {
    sectionRef.current?.querySelector('input, select')?.focus();
  }, []);

  async function submit() {
    if (busy) return;
    const verdict = validatePayment(payment, { today: invoiceDateIn(new Date(), timeZone) });
    if (!verdict.ok) {
      setErrors(issuesByPath(verdict.issues));
      setFocusRequest((count) => count + 1);
      return;
    }
    setErrors(new Map());
    setServerError(null);
    try {
      await onSubmit(verdict.value);
    } catch (err) {
      setServerError(err);
      setErrors(fieldErrorsOf(err));
    }
  }

  const set = (patch) => setPayment((current) => ({ ...current, ...patch }));
  return (
    <section ref={sectionRef} aria-labelledby={headingId} className="flex flex-col gap-sm border-admin-rule-hairline border-t-admin-hairline pt-sm">
      <h3 id={headingId} className="text-admin-base font-bold text-admin-ink">Record a payment</h3>
      <ServerErrorSummary error={serverError} title="The payment was not recorded" />
      <div className="flex flex-wrap items-start gap-sm">
        <TextField
          label="Date paid"
          type="date"
          hint={`The date it arrived, on the event's clock${timeZone ? ` (${timeZone})` : ''}.`}
          value={payment.paidOn}
          onChange={(value) => set({ paidOn: value })}
          error={errors.get('paidOn')}
          className="sm:max-w-[16rem]"
        />
        <SelectField
          label="Method"
          value={payment.method}
          onChange={(value) => set({ method: value })}
          error={errors.get('method')}
          options={PAYMENT_METHODS.map((method) => ({ value: method, label: PAYMENT_METHOD_WORDS[method] }))}
        />
      </div>
      <TextField
        label="Payment note"
        hint="Optional. Such as a check number or a bank reference."
        value={payment.note}
        onChange={(value) => set({ note: value })}
        error={errors.get('note')}
        maxLength={INVOICE_LIMITS.paymentNote}
        className="sm:max-w-[28rem]"
      />
      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={primaryButtonClass} disabled={busy} aria-busy={busy || undefined} onClick={submit}>
          {busy ? 'Recording…' : 'Record payment'}
        </button>
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/**
 * An operator's action that needs a reason: Void (on the alarm ground; the
 * number stays used) and Reopen (a paid invoice back to issued; the payment
 * is kept in the history). A press with no reason moves focus to the field.
 */
function ReasonForm({ title, explanation, label, hint, maxLength, validate, confirmLabel, busyLabel, errorTitle, alarm, busy, onSubmit, onCancel }) {
  const headingId = useId();
  const sectionRef = useRef(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [serverError, setServerError] = useState(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(sectionRef.current);
  }, [focusRequest]);

  // The button that opened the form is gone, so the keyboard starts here.
  useEffect(() => {
    sectionRef.current?.querySelector('input')?.focus();
  }, []);

  async function submit() {
    if (busy) return;
    const verdict = validate(reason);
    if (!verdict.ok) {
      setError(verdict.issues[0].message);
      setFocusRequest((count) => count + 1);
      return;
    }
    setError('');
    setServerError(null);
    try {
      await onSubmit(verdict.value);
    } catch (err) {
      setServerError(err);
    }
  }

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className={alarm
        ? 'flex flex-col gap-xs rounded-admin-panel border-admin-alarm border-admin-rule-alarm bg-admin-ground-alarm px-md py-sm'
        : 'flex flex-col gap-xs rounded-admin-panel border-admin-hairline border-admin-rule-strong bg-admin-ground-raised px-md py-sm'}
    >
      <h3 id={headingId} className={`text-admin-base font-bold ${alarm ? 'text-admin-state-error' : 'text-admin-ink'}`}>{title}</h3>
      <p className="max-w-[65ch] text-admin-sm text-admin-ink">{explanation}</p>
      <ServerErrorSummary error={serverError} title={errorTitle} />
      <TextField
        label={label}
        hint={hint}
        value={reason}
        onChange={setReason}
        error={error}
        maxLength={maxLength}
        className="sm:max-w-[28rem]"
      />
      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={alarm ? dangerButtonClass : primaryButtonClass} disabled={busy} aria-busy={busy || undefined} onClick={submit}>
          {busy ? busyLabel : confirmLabel}
        </button>
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>
          Keep it
        </button>
      </div>
    </section>
  );
}

/** The payments a reopen undid, oldest first. */
function PaymentHistory({ history }) {
  const headingId = useId();
  if (!history?.length) return null;
  return (
    <div className="flex flex-col gap-3xs">
      <h3 id={headingId} className="text-admin-base font-bold text-admin-ink">Earlier payments</h3>
      <ul aria-labelledby={headingId} className="flex list-disc flex-col gap-3xs ps-5 text-admin-sm text-admin-ink">
        {history.map((entry, index) => (
          <li key={`${entry.paidOn}-${index}`}>
            <span className="font-admin-data tabular-nums">{entry.paidOn}</span>
            {`, ${PAYMENT_METHOD_WORDS[entry.method] ?? 'Other'}`}
            {entry.note ? `, ${entry.note}` : ''}
            {`. Reopened: ${entry.reason || 'no reason given'}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * @param {{ invoice: object, canVoid: boolean, canReopen: boolean, timeZone?: string, busy: string|null,
 *           onMarkPaid: (payment: object) => Promise<void>, onVoid: (reason: string) => Promise<void>,
 *           onReopen: (reason: string) => Promise<void>, onDuplicate: () => void }} props
 */
export default function InvoiceRecord({ invoice, canVoid, canReopen, timeZone, busy, onMarkPaid, onVoid, onReopen, onDuplicate }) {
  const headingId = useId();
  const [open, setOpen] = useState(null);
  const issuer = invoice.issuer ?? {};
  const status = invoice.status;

  return (
    <section aria-labelledby={headingId} className={panelClass}>
      <div className="mb-sm border-admin-rule-hairline border-b-admin-hairline pb-sm">
        <h2 id={headingId} className="font-admin-ui text-admin-lg font-bold text-admin-ink">Invoice record</h2>
        <p className="mt-3xs max-w-[65ch] text-admin-sm text-admin-ink-secondary">
          Fixed when the invoice was issued. Later changes to the invoice settings do not change it.
        </p>
      </div>
      <div className="flex flex-col gap-md">
        <dl className="grid max-w-[40rem] grid-cols-[minmax(8rem,auto)_1fr] gap-x-md gap-y-3xs text-admin-base">
          <Row term="Number"><span className="font-admin-data">{invoice.number}</span></Row>
          <Row term="Issue date"><span className="font-admin-data tabular-nums">{invoice.issueDate}</span></Row>
          <Row term="Due date">{invoice.dueDate ? <span className="font-admin-data tabular-nums">{invoice.dueDate}</span> : 'On receipt'}</Row>
          <Row term="From">{issuer.name}</Row>
          <Row term="Address">{issuer.address}</Row>
          <Row term="Email">{issuer.email}</Row>
          <Row term="Tax ID">{issuer.taxId}</Row>
          <Row term="How to pay">{issuer.paymentInstructions}</Row>
          {invoice.payment ? (
            <>
              <Row term="Paid on"><span className="font-admin-data tabular-nums">{invoice.payment.paidOn}</span></Row>
              <Row term="Method">{PAYMENT_METHOD_WORDS[invoice.payment.method] ?? 'Other'}</Row>
              <Row term="Payment note">{invoice.payment.note}</Row>
            </>
          ) : null}
          {invoice.voided ? <Row term="Void reason">{invoice.voided.reason}</Row> : null}
        </dl>
        <PaymentHistory history={invoice.paymentHistory} />
        {status === 'void' ? (
          <p className="max-w-[65ch] text-admin-sm text-admin-ink-secondary">
            {invoice.number} stays used. It is never given to another invoice. To bill again, duplicate this invoice as a new draft.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-xs">
          {status === 'issued' && open !== 'paid' ? (
            <button type="button" className={secondaryButtonClass} disabled={busy !== null} onClick={() => setOpen('paid')}>
              Mark paid
            </button>
          ) : null}
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy !== null}
            aria-busy={busy === 'duplicate' || undefined}
            onClick={onDuplicate}
          >
            {busy === 'duplicate' ? 'Copying…' : 'Duplicate as a new draft'}
          </button>
          {status === 'paid' && canReopen && open !== 'reopen' ? (
            <button type="button" className={secondaryButtonClass} disabled={busy !== null} onClick={() => setOpen('reopen')}>
              Reopen this invoice
            </button>
          ) : null}
          {status !== 'void' && canVoid && open !== 'void' ? (
            <button type="button" className={`${dangerButtonClass} ms-auto`} disabled={busy !== null} onClick={() => setOpen('void')}>
              Void this invoice
            </button>
          ) : null}
        </div>
        {status !== 'void' && !canVoid ? (
          <p className="text-admin-sm text-admin-ink-secondary">
            Only an operator can void an invoice or reopen a paid one. To correct this one, ask an operator to void it, then duplicate it.
          </p>
        ) : null}

        {open === 'paid' && status === 'issued' ? (
          <MarkPaidForm
            timeZone={timeZone}
            busy={busy === 'paid'}
            onCancel={() => setOpen(null)}
            onSubmit={async (payment) => {
              await onMarkPaid(payment);
              setOpen(null);
            }}
          />
        ) : null}
        {open === 'void' && status !== 'void' ? (
          <ReasonForm
            alarm
            title={`Void ${invoice.number}?`}
            explanation="The invoice stays in the list as Void, and its number is never given to another invoice. A void cannot be undone. To bill again, duplicate it as a new draft."
            label="Reason"
            hint="Required. Kept with the invoice and in the audit log."
            maxLength={INVOICE_LIMITS.voidReason}
            validate={validateVoidReason}
            confirmLabel={`Void ${invoice.number}`}
            busyLabel="Voiding…"
            errorTitle="The invoice was not voided"
            busy={busy === 'void'}
            onCancel={() => setOpen(null)}
            onSubmit={async (reason) => {
              await onVoid(reason);
              setOpen(null);
            }}
          />
        ) : null}
        {open === 'reopen' && status === 'paid' ? (
          <ReasonForm
            title={`Reopen ${invoice.number}?`}
            explanation="The invoice goes back to Issued, so it can be paid again. The payment is not deleted: it moves to Earlier payments with your reason."
            label="Reason for reopening"
            hint="Required. Such as a bounced check. Kept with the payment and in the audit log."
            maxLength={INVOICE_LIMITS.reopenReason}
            validate={validateReopenReason}
            confirmLabel={`Reopen ${invoice.number}`}
            busyLabel="Reopening…"
            errorTitle="The invoice was not reopened"
            busy={busy === 'reopen'}
            onCancel={() => setOpen(null)}
            onSubmit={async (reason) => {
              await onReopen(reason);
              setOpen(null);
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
