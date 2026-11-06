// Public feedback/bug modal (issue #28, spec §9 "Feedback inbox").
// Anti-spam pairing with functions/src/admin/feedback.cjs's server checks:
//   - `website` is a honeypot field, visually hidden and out of the tab
//     order — a real visitor never sees or fills it, so any value there
//     tells the server this submission is scripted.
//   - `startedAt` (captured on mount) is the client half of the server's
//     minimum-time gate — how long the form was open before submit.
//   - `submissionKey` is bound to the normalized message, email, and category.
//     An identical retry keeps the key, while an edit takes a new key, so a
//     dropped response cannot duplicate or silently replace the submission.
// None of these checks are enforced here: the server is the actual gate,
// and this modal just carries the signals it needs. Fails soft — a
// submission error is shown inline; it never throws out of the component.
//
// Editorial base restyle (design brief §2.1, §2.4): the dialog's elevation
// is a tinted ink scrim (--color-text-primary at low alpha, no blur) behind
// a strong-rule frame — never a shadow, never a rounded card. The fields
// come from components/forms/publicForm.jsx, which reads the tier-2 tokens
// this surface reads: this is a visitor-facing form, so it must never take
// the admin identity's grounds and faces (design brief §3.1, §5.2). The
// buttons are the shared action classes from controlClasses.js, sized by
// their own content rather than stretched across the dialog. Every form
// `<label>` in SelectField/TextAreaField/TextField stays above its input —
// a control label is the one exemption the eyebrow ban names (§2.4), never
// an eyebrow to "fix".
//
// Native <dialog>, opened with showModal(), owns the inert background,
// Escape cancellation and top-layer placement. Native Tab navigation can
// still leave the document for browser controls at a boundary, so the shared
// modal focus helper wraps the first and last available controls. The
// browser handles ordinary focus traversal inside those boundaries.
//
// The component chooses the initial field and receipt focus, locks page
// scrolling, and returns focus to the opener when React removes the dialog.
//
// TWO KINDS OF REFUSAL, TWO PLACES (issue 219). A field that refuses states
// it on the field: `aria-invalid`, the message under it named by
// `aria-describedby`, and focus moved there on submit, so the label, the
// state and the message are read as one. A refusal from the SERVER belongs
// to the request rather than to any field, so that one stays the single
// urgent line at the head of the form. One result, announced once: the
// field's message is not repeated in the summary, because the focus move
// is what announces it.
import { useEffect, useId, useRef, useState } from 'react';
import { submitFeedback } from '../lib/feedbackApi.js';
import { createSubmissionKey } from '../lib/submissionKey.js';
import { wrapModalTab } from '../lib/modalFocus.js';
import useLoadingStage from '../lib/useLoadingStage.js';
import { focusFirstError, SelectField, TextAreaField, TextField } from './forms/publicForm.jsx';
import { primaryActionClass, secondaryActionClass } from './controlClasses.js';
import LoadingStatus from './LoadingStatus.jsx';

/**
 * The dialog's frame: the strong rule on the page ground, at the reading
 * width. Exported so the specimen book draws the frame from this string
 * rather than from a copy of it.
 *
 * `.public-dialog` is not in here. That class is the element's own
 * behaviour — how tall a native dialog may grow, how it scrolls, and what
 * its backdrop paints — and it belongs only on the <dialog> itself.
 */
export const DIALOG_FRAME_CLASS =
  'w-full max-w-lg border-strong border-rule-strong bg-surface p-lg';

/** The server's stored-message limit (functions/src/admin/feedback.cjs). */
export const MAX_MESSAGE_LENGTH = 4000;

const CATEGORY_OPTIONS = [
  { value: 'feedback', label: 'General feedback' },
  { value: 'bug', label: 'Something is broken' },
  { value: 'other', label: 'Other' },
];

export default function FeedbackModal({ onClose }) {
  const titleId = useId();
  const receiptId = `${titleId}-receipt`;
  const startedAtRef = useRef(Date.now());
  const [submissionKey] = useState(createSubmissionKey);
  // React state paints the pending UI; this guard also covers a second
  // submit or Escape delivered before that render has committed.
  const submissionStateRef = useRef('idle');
  const requestAbortRef = useRef(null);
  const mountedRef = useRef(false);

  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('feedback');
  const [website, setWebsite] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [messageError, setMessageError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const { stage: submissionStage } = useLoadingStage({ active: submitting });

  const dialogRef = useRef(null);
  const formRef = useRef(null);
  const receiptHeadingRef = useRef(null);
  // Capture the opener before showModal moves focus into the dialog.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mountedRef.current = true;
    // Native modality owns the inert background. Where it is missing the
    // dialog still opens and the form remains reachable, but that native
    // isolation is unavailable.
    if (typeof dialog?.showModal === 'function') dialog.showModal();
    else if (dialog) dialog.setAttribute('open', '');
    // Native dialog focusing can choose the first select, even when React
    // has already applied autoFocus to the textarea before showModal.
    formRef.current?.querySelector('textarea')?.focus();
    return () => {
      mountedRef.current = false;
      requestAbortRef.current?.abort();
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener && typeof opener.focus === 'function' && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [opener]);

  useEffect(() => {
    if (receipt) receiptHeadingRef.current?.focus();
  }, [receipt]);

  function closeDialog() {
    // Closing is not cancellation: the server may already be saving the
    // message. Keep its result visible until the request has settled.
    if (submissionStateRef.current !== 'pending') onClose();
  }

  async function submit(event) {
    event.preventDefault();
    if (submissionStateRef.current !== 'idle') return;
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      // The field says it, and the reader is put in front of the field.
      setMessageError('Please enter a message.');
      // A rejection from the server, if one is still standing, goes now:
      // nothing is being sent, so it would be stating a problem that may
      // already be fixed.
      setError(null);
      // After the render that marks the field, not before it. The submit
      // control stays enabled throughout — a dead control announces
      // nothing.
      window.setTimeout(() => focusFirstError(formRef.current), 0);
      return;
    }
    if (normalizedMessage.length > MAX_MESSAGE_LENGTH) {
      setMessageError(`Please keep your message to ${MAX_MESSAGE_LENGTH.toLocaleString('en-US')} characters.`);
      setError(null);
      window.setTimeout(() => focusFirstError(formRef.current), 0);
      return;
    }
    submissionStateRef.current = 'pending';
    setSubmitting(true);
    setError(null);
    setMessageError(null);
    const payload = {
      message: normalizedMessage,
      email: email.trim().toLowerCase() || undefined,
      category,
    };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    requestAbortRef.current = controller;
    let result;
    try {
      result = await submitFeedback({
        ...payload,
        honeypot: website,
        startedAt: startedAtRef.current,
        submissionKey: submissionKey.keyFor(payload),
      }, { signal: controller?.signal });
    } catch {
      // The API normally returns a fail-soft result. Preserve a retry even
      // if an unexpected client failure breaks that contract.
      result = { ok: false, error: 'We could not confirm your feedback was received. Please try again.' };
    }
    if (requestAbortRef.current === controller) requestAbortRef.current = null;
    submissionStateRef.current = result.ok ? 'sent' : 'idle';
    if (!mountedRef.current) return;
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Receipt copy describes the payload that actually completed, never a
    // later edit to the form while a response was on its way.
    setReceipt(payload);
  }

  return (
    // Escape reaches the dialog as `cancel`. Its default would close the
    // element while React still believed it was open, so the close is handed
    // to the caller instead, and the caller unmounts the dialog.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`public-dialog motion-enter ${DIALOG_FRAME_CLASS}`}
      onKeyDown={wrapModalTab}
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
    >
      <div>
        {receipt ? (
          <div className="flex flex-col gap-md">
            <h2
              ref={receiptHeadingRef}
              id={titleId}
              tabIndex={-1}
              aria-describedby={receiptId}
              className="font-heading text-h3 font-semibold text-text-primary"
            >
              Thanks for letting us know
            </h2>
            <p id={receiptId} className="font-data text-caption text-text-secondary">
              {/* Receipt-only wording: the backend's confirmation send is
                  best-effort and swallows its own failures (spec: a failed
                  send never turns an already-durable submission into a
                  caller-visible error), so this must never assert that an
                  email was actually delivered — only that the message
                  itself was received. */}
              We got your feedback.
              {receipt.email ? ' If you left an email, we’ll try to send a confirmation.' : null}
            </p>
            <div>
              <button type="button" className={primaryActionClass} onClick={closeDialog}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form ref={formRef} className="flex flex-col gap-md" onSubmit={submit}>
            <h2 id={titleId} className="font-heading text-h3 font-semibold text-text-primary">
              Share feedback
            </h2>

            {error ? (
              <p role="alert" className="rounded-brand border-hairline border-danger/40 bg-danger/10 px-sm py-xs font-data text-caption text-danger">
                {error}
              </p>
            ) : null}

            <SelectField
              label="What is this about?"
              value={category}
              onChange={(next) => {
                if (submissionStateRef.current === 'idle') setCategory(next);
              }}
              options={CATEGORY_OPTIONS}
              disabled={submitting}
            />
            <TextAreaField
              label="Message"
              value={message}
              // THE MARK COMES OFF WHEN THE ANSWER ARRIVES. The field held
              // `aria-invalid` and its message while the reader typed the
              // very thing it asked for, so the field went on announcing
              // itself as invalid after it was not. A value that is still
              // only whitespace has not answered it, so the mark stays.
              onChange={(next) => {
                if (submissionStateRef.current !== 'idle') return;
                setMessage(next);
                if (messageError && next.trim() && next.trim().length <= MAX_MESSAGE_LENGTH) {
                  setMessageError(null);
                }
              }}
              error={messageError}
              hint={`Up to ${MAX_MESSAGE_LENGTH.toLocaleString('en-US')} characters.`}
              rows={5}
              maxLength={MAX_MESSAGE_LENGTH}
              readOnly={submitting}
            />
            <TextField
              label="Email (optional)"
              type="email"
              value={email}
              onChange={(next) => {
                if (submissionStateRef.current === 'idle') setEmail(next);
              }}
              hint="Leave your email if you’d like a reply."
              readOnly={submitting}
            />

            {/* Honeypot: visually hidden, out of tab order, and never
                announced — a real person cannot perceive or fill this in. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
              <label htmlFor={`${titleId}-website`}>Leave this field blank</label>
              <input
                id={`${titleId}-website`}
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                disabled={submitting}
                onChange={(event) => {
                  if (submissionStateRef.current === 'idle') setWebsite(event.target.value);
                }}
              />
            </div>

            <div className="font-data text-caption text-text-secondary">
              <LoadingStatus
                stage={submissionStage}
                label={submitting ? 'Sending your feedback. Keep this window open until we confirm it was received.' : ''}
              />
            </div>

            <div className="flex flex-wrap justify-end gap-xs">
              <button
                type="button"
                className={secondaryActionClass}
                aria-disabled={submitting || undefined}
                onClick={closeDialog}
              >
                Cancel
              </button>
              {/* Keep focus on the action while the request runs. The ref
                  guard refuses duplicate submits from every input path. */}
              <button
                type="submit"
                className={primaryActionClass}
                aria-disabled={submitting || undefined}
                aria-busy={submitting || undefined}
              >
                <span className="public-action-label">
                  <span aria-hidden={submitting || undefined}>Send feedback</span>
                  <span aria-hidden={!submitting || undefined}>Sending feedback…</span>
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
