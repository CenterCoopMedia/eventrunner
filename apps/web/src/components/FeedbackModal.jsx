// Public feedback/bug modal (issue #28, spec §9 "Feedback inbox").
// Anti-spam pairing with functions/src/admin/feedback.cjs's server checks:
//   - `website` is a honeypot field, visually hidden and out of the tab
//     order — a real visitor never sees or fills it, so any value there
//     tells the server this submission is scripted.
//   - `startedAt` (captured on mount) is the client half of the server's
//     minimum-time gate — how long the form was open before submit.
//   - `submissionKey` (generated once per form-open session, below) is an
//     idempotency token: it stays the SAME across every retry of the same
//     submission (a "Send feedback" click after a network error retries
//     with the identical key), so a retry after a dropped response updates
//     the same server-side doc/email claim instead of creating a duplicate
//     row and a duplicate confirmation email (Codex P2 finding).
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
// A NATIVE <dialog>, OPENED WITH showModal(). This used to be a z-50 <div>
// over the page, so Tab walked straight out of it and into the page behind
// — including the fixed back-to-top control. `showModal()` is the platform's
// own answer and it is four behaviours in one call: focus is trapped inside
// the dialog, everything behind it is inert to the pointer and to assistive
// technology, Escape fires `cancel`, and the top layer puts the dialog above
// every stacking context without a z-index. None of that is reimplemented
// here, because a hand-written trap is a list of focusable selectors that
// goes stale the moment a control is added.
//
// The one thing the component still owns is the RETURN of focus. React
// unmounts the dialog on close, and an element removed while it holds focus
// drops focus to the body, so the opener is remembered on mount and focused
// again on the way out.
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
import { focusFirstError, SelectField, TextAreaField, TextField } from './forms/publicForm.jsx';
import { primaryActionClass, secondaryActionClass } from './controlClasses.js';

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

const CATEGORY_OPTIONS = [
  { value: 'feedback', label: 'General feedback' },
  { value: 'bug', label: 'Something is broken' },
  { value: 'other', label: 'Other' },
];

export default function FeedbackModal({ onClose }) {
  const titleId = useId();
  const startedAtRef = useRef(Date.now());
  // One id per form-open session, resent unchanged on every retry — see the
  // module comment. crypto.randomUUID() output (36 chars incl. hyphens)
  // satisfies the server's SUBMISSION_KEY_RE (8-128 of [A-Za-z0-9_-]) once
  // the hyphens are stripped, so the server never sees a shape it rejects.
  const submissionKeyRef = useRef(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
  );

  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('feedback');
  const [website, setWebsite] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [messageError, setMessageError] = useState(null);
  const [sent, setSent] = useState(false);

  const dialogRef = useRef(null);
  const formRef = useRef(null);
  // The opener is read at the FIRST RENDER, not in the effect. The message
  // field carries autoFocus, and React applies that during the commit, so by
  // the time an effect runs the active element is already the field inside
  // the dialog — and the dialog would then try to give focus back to itself.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));

  useEffect(() => {
    const dialog = dialogRef.current;
    // `showModal` is the whole mechanism. Where it is missing the dialog
    // still opens and the form still works; what is lost is the trap, and a
    // visitor can still reach every control and close the dialog.
    if (typeof dialog?.showModal === 'function') dialog.showModal();
    else if (dialog) dialog.setAttribute('open', '');
    return () => {
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
    };
  }, [opener]);

  async function submit(event) {
    event.preventDefault();
    if (!message.trim()) {
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
    setSubmitting(true);
    setError(null);
    setMessageError(null);
    const result = await submitFeedback({
      message: message.trim(),
      email: email.trim() || undefined,
      category,
      honeypot: website,
      startedAt: startedAtRef.current,
      submissionKey: submissionKeyRef.current,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    // Escape reaches the dialog as `cancel`. Its default would close the
    // element while React still believed it was open, so the close is handed
    // to the caller instead, and the caller unmounts the dialog.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={`public-dialog motion-enter ${DIALOG_FRAME_CLASS}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div>
        {sent ? (
          <div className="flex flex-col gap-md">
            <h2 id={titleId} className="font-heading text-h3 font-semibold text-text-primary">
              Thanks for letting us know
            </h2>
            <p role="status" className="font-data text-caption text-text-secondary">
              {/* Receipt-only wording: the backend's confirmation send is
                  best-effort and swallows its own failures (spec: a failed
                  send never turns an already-durable submission into a
                  caller-visible error), so this must never assert that an
                  email was actually delivered — only that the message
                  itself was received. */}
              We got your feedback.
              {email.trim() ? ' If you left an email, we’ll try to send a confirmation.' : null}
            </p>
            <div>
              <button type="button" className={primaryActionClass} onClick={onClose}>
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
              onChange={setCategory}
              options={CATEGORY_OPTIONS}
            />
            <TextAreaField
              label="Message"
              value={message}
              onChange={setMessage}
              error={messageError}
              rows={5}
              autoFocus
            />
            <TextField
              label="Email (optional)"
              type="email"
              value={email}
              onChange={setEmail}
              hint="Leave your email if you’d like a reply."
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
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>

            <div className="flex flex-wrap justify-end gap-xs">
              <button type="button" className={secondaryActionClass} onClick={onClose}>
                Cancel
              </button>
              {/* Busy is a stated word and `aria-busy`, never a spinner. The
                  control is disabled only once the request has started. */}
              <button
                type="submit"
                className={primaryActionClass}
                disabled={submitting}
                aria-busy={submitting || undefined}
              >
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
