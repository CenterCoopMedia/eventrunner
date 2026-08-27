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
// a strong-rule frame — never a shadow, never a rounded card. The two
// formControls.jsx button classes are local to that file's own (non-full-
// width) call sites, so this modal keeps its own button classes rather than
// importing theirs; both read the same tier-2 tokens the rest of the base
// system uses. Every form `<label>` in SelectField/TextAreaField/TextField
// stays above its input — a control label is the one exemption the eyebrow
// ban names (§2.4), never an eyebrow to "fix".
import { useEffect, useId, useRef, useState } from 'react';
import { submitFeedback } from '../lib/feedbackApi.js';
import { SelectField, TextAreaField, TextField } from '../admin/components/formControls.jsx';
import { primaryActionClass, secondaryActionClass } from './controlClasses.js';

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
  const [sent, setSent] = useState(false);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    if (!message.trim()) {
      setError('Please enter a message.');
      return;
    }
    setSubmitting(true);
    setError(null);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 px-md py-xl"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg border-strong border-rule-strong bg-surface p-lg"
        onClick={(event) => event.stopPropagation()}
      >
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
              {email.trim() ? " If you left an email, we'll try to send a confirmation." : null}
            </p>
            <div>
              <button type="button" className={primaryActionClass} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-md" onSubmit={submit}>
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
              rows={5}
              autoFocus
            />
            <TextField
              label="Email (optional)"
              type="email"
              value={email}
              onChange={setEmail}
              hint="Leave your email if you'd like a reply."
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
              <button type="submit" className={primaryActionClass} disabled={submitting}>
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
