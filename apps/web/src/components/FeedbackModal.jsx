// Public feedback/bug modal (issue #28, spec §9 "Feedback inbox").
// Anti-spam pairing with functions/src/admin/feedback.cjs's server checks:
//   - `website` is a honeypot field, visually hidden and out of the tab
//     order — a real visitor never sees or fills it, so any value there
//     tells the server this submission is scripted.
//   - `startedAt` (captured on mount) is the client half of the server's
//     minimum-time gate — how long the form was open before submit.
// Neither check is enforced here: the server is the actual gate, and this
// modal just carries the two signals it needs. Fails soft — a submission
// error is shown inline; it never throws out of the component.
import { useEffect, useId, useRef, useState } from 'react';
import { submitFeedback } from '../lib/feedbackApi.js';
import {
  SelectField,
  TextAreaField,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../admin/components/formControls.jsx';

const CATEGORY_OPTIONS = [
  { value: 'feedback', label: 'General feedback' },
  { value: 'bug', label: 'Something is broken' },
  { value: 'other', label: 'Other' },
];

export default function FeedbackModal({ onClose }) {
  const titleId = useId();
  const startedAtRef = useRef(Date.now());

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-brand-lg border border-brand-ink/10 bg-brand-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        {sent ? (
          <div className="flex flex-col gap-4">
            <h2 id={titleId} className="font-heading text-xl font-semibold text-brand-ink">
              Thanks for letting us know
            </h2>
            <p role="status" className="text-sm text-brand-ink-muted">
              {email.trim()
                ? 'We received your message and sent a confirmation to your email.'
                : 'We received your message.'}
            </p>
            <div>
              <button type="button" className={primaryButtonClass} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <h2 id={titleId} className="font-heading text-xl font-semibold text-brand-ink">
              Share feedback
            </h2>

            {error ? (
              <p role="alert" className="rounded-brand border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
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

            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={secondaryButtonClass} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={primaryButtonClass} disabled={submitting}>
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
