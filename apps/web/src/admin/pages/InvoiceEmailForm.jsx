// Email an issued or paid invoice (issue #208, part 4).
//
// The PDF goes to the billing email on the invoice. Staff may add one copy
// address and a short note. They preview first: the server answers the
// subject, the bodies, the file name and a receipt, and the send must carry
// that receipt, so the email that goes is the one staff read. Changing the
// copy address or the note drops the preview, and a new one is needed; a
// preview answer that arrives after such a change is dropped too.
//
// One send id per preview: a double press or a retry after a lost answer
// sends the same id, and the server sends nothing the second time. When the
// same address got this invoice a few minutes ago, the server says so in the
// preview, and the send needs "Send it again anyway".
//
// The form sits inside the editor's <form>, so its controls are plain
// buttons. A press with a field the rules refuse moves focus to that field.
import { useEffect, useId, useRef, useState } from 'react';
import { INVOICE_LIMITS, validateInvoiceSend } from 'shared/invoice';
import {
  CheckboxField,
  FieldError,
  Notice,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import { messageOf } from '../invoiceDoc.js';
import { focusFirstError } from '../../lib/focusFirstError.js';

/** One id per preview, sent with every press of Send for it. */
export function mintSendId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `send_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `send_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

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

const termClass = 'text-admin-ink-secondary';
const valueClass = 'min-w-0 break-words';

/** The email as the server will send it. */
function EmailPreview({ preview }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-xs rounded-admin-panel border-admin-hairline border-admin-rule-hairline bg-admin-ground px-md py-sm">
      <h4 id={headingId} className="text-admin-base font-bold text-admin-ink">Email preview</h4>
      <dl className="grid max-w-[40rem] grid-cols-[minmax(6rem,auto)_1fr] gap-x-md gap-y-3xs text-admin-sm">
        <dt className={termClass}>To</dt>
        <dd className={valueClass}>{preview.to}</dd>
        {preview.cc ? (
          <>
            <dt className={termClass}>Copy to</dt>
            <dd className={valueClass}>{preview.cc}</dd>
          </>
        ) : null}
        {preview.replyTo ? (
          <>
            <dt className={termClass}>Replies go to</dt>
            <dd className={valueClass}>{preview.replyTo}</dd>
          </>
        ) : null}
        <dt className={termClass}>Subject</dt>
        <dd className={valueClass}>{preview.subject}</dd>
        <dt className={termClass}>Attachment</dt>
        <dd className={`${valueClass} font-admin-data`}>{preview.filename}</dd>
      </dl>
      <pre className="max-h-[24rem] overflow-auto whitespace-pre-wrap break-words rounded-admin-small border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-sm font-admin-ui text-admin-sm text-admin-ink">
        {preview.text}
      </pre>
    </section>
  );
}

/**
 * @param {{ invoice: object, busy: boolean,
 *           onPreview: (input: { cc: string, note: string }) => Promise<object>,
 *           onSend: (input: { cc: string, note: string, sendId: string, receipt: string, confirmResend: boolean }) => Promise<void>,
 *           onCancel: () => void }} props
 */
export default function InvoiceEmailForm({ invoice, busy, onPreview, onSend, onCancel }) {
  const headingId = useId();
  const confirmErrorId = useId();
  const sectionRef = useRef(null);
  const to = invoice.billTo?.email ?? '';
  const [input, setInput] = useState({ cc: '', note: '' });
  const [errors, setErrors] = useState(new Map());
  const [serverError, setServerError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  // Bumped on every edit. A preview answer for an older version of the copy
  // address or the note is dropped, so Send never carries stale input.
  const inputVersion = useRef(0);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(sectionRef.current);
  }, [focusRequest]);

  // The button that opened the form is gone, so the keyboard starts here.
  useEffect(() => {
    sectionRef.current?.querySelector('input')?.focus();
  }, []);

  function change(patch) {
    inputVersion.current += 1;
    setInput((current) => ({ ...current, ...patch }));
    // What the preview showed is no longer what would be sent.
    setPreview(null);
    setConfirm(false);
    setConfirmError('');
  }

  function checked() {
    const verdict = validateInvoiceSend(input, { to });
    if (!verdict.ok) {
      setErrors(issuesByPath(verdict.issues));
      setFocusRequest((count) => count + 1);
      return null;
    }
    setErrors(new Map());
    return { cc: verdict.value.cc ?? '', note: verdict.value.note };
  }

  async function showPreview() {
    if (busy || previewing) return;
    const value = checked();
    if (!value) return;
    setServerError(null);
    setPreviewing(true);
    const version = inputVersion.current;
    try {
      const result = await onPreview(value);
      // The copy address or the note changed while the preview was on its
      // way: it shows an email that would not be sent. Drop it.
      if (version !== inputVersion.current) return;
      setPreview({ ...result, input: value, sendId: mintSendId() });
      setConfirm(false);
      setConfirmError('');
    } catch (err) {
      if (version !== inputVersion.current) return;
      setServerError(err);
      setErrors(fieldErrorsOf(err));
    } finally {
      setPreviewing(false);
    }
  }

  async function send() {
    if (busy || !preview?.canSend) return;
    if (preview.recentSend && !confirm) {
      setConfirmError('Tick this box to send the invoice again, or select Cancel.');
      setFocusRequest((count) => count + 1);
      return;
    }
    setConfirmError('');
    setServerError(null);
    try {
      await onSend({
        ...preview.input,
        sendId: preview.sendId,
        receipt: preview.receipt,
        confirmResend: Boolean(preview.recentSend) && confirm,
      });
    } catch (err) {
      setServerError(err);
      setErrors(fieldErrorsOf(err));
      // A refusal that names a changed preview or a recent send needs a new
      // preview; the old receipt and send id are not used again.
      if (['stale-preview', 'recent-send'].includes(err?.code)) setPreview(null);
    }
  }

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className="flex flex-col gap-sm border-admin-rule-hairline border-t-admin-hairline pt-sm">
      <h3 id={headingId} className="text-admin-base font-bold text-admin-ink">{`Email ${invoice.number}`}</h3>
      <p className="max-w-[65ch] text-admin-sm text-admin-ink">
        {'The PDF goes to the billing email on the invoice: '}
        <strong className="font-semibold">{to}</strong>
        {'. Preview the email before you send it.'}
      </p>
      <ServerErrorSummary error={serverError} title="The invoice was not emailed" />
      <TextField
        label="Copy to"
        type="email"
        autoComplete="off"
        hint="Optional. One more address that gets the same email, such as your finance team."
        value={input.cc}
        onChange={(value) => change({ cc: value })}
        error={errors.get('cc')}
        maxLength={INVOICE_LIMITS.email}
        className="sm:max-w-[28rem]"
      />
      <TextAreaField
        label="Note"
        hint={`Optional. Shown in the email under the line that names the invoice. Up to ${INVOICE_LIMITS.sendNote} characters.`}
        value={input.note}
        onChange={(value) => change({ note: value })}
        error={errors.get('note')}
        maxLength={INVOICE_LIMITS.sendNote}
        rows={3}
        className="sm:max-w-[40rem]"
      />
      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={secondaryButtonClass} disabled={busy || previewing} aria-busy={previewing || undefined} onClick={showPreview}>
          {previewing ? 'Preparing preview…' : 'Preview email'}
        </button>
        {!preview ? (
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>

      {preview ? (
        <>
          <EmailPreview preview={preview.preview} />
          {!preview.canSend ? (
            <Notice tone="caution" message={preview.cannotSendReason} />
          ) : null}
          {preview.canSend && preview.recentSend ? (
            <div className="flex flex-col gap-3xs">
              <Notice
                tone="caution"
                message={`${invoice.number} was emailed to ${preview.recentSend.to} less than ${preview.resendWindowMinutes} minutes ago.`}
              />
              <CheckboxField
                label="Send it again anyway"
                checked={confirm}
                onChange={(value) => {
                  setConfirm(value);
                  if (value) setConfirmError('');
                }}
                aria-invalid={confirmError ? 'true' : undefined}
                aria-describedby={confirmError ? confirmErrorId : undefined}
              />
              <FieldError id={confirmErrorId} message={confirmError} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-xs">
            {preview.canSend ? (
              <button type="button" className={primaryButtonClass} disabled={busy} aria-busy={busy || undefined} onClick={send}>
                {busy ? 'Sending…' : `Send to ${preview.preview.to}`}
              </button>
            ) : null}
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
