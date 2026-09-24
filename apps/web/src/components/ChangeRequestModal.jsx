// Public change request dialog (issue #188), opened from the footer when the
// event turns `changeRequests` on and the reader is signed in (Layout.jsx).
// The server is the gate: submitChangeRequest refuses every request while
// the flag is off, takes the sender from the ID token, and rate limits each
// account. This dialog only carries the request there and states the answer.
//
// The dialog mechanics are FeedbackModal.jsx's, for the same reasons (read
// its comment): a native <dialog> opened with showModal(), so the focus trap,
// the inert page, Escape, and the top layer come from the platform; Escape
// arrives as `cancel` and is handed to the caller; the opener is read at the
// first render and gets focus back on the way out. The frame is the same
// string, imported from there. The fields come from forms/publicForm.jsx,
// because this is a visitor-facing form and never takes the admin identity.
//
// `submissionKey` is made once per dialog and resent unchanged on a retry of
// the same text, so a retry after a dropped response finds the stored
// request rather than storing it twice. Edited text takes a new key
// (lib/submissionKey.js).
//
// A field that refuses says so on the field and takes focus; a refusal from
// the server belongs to the request and stays one urgent line at the head
// of the form (issue 219).
import { useEffect, useId, useRef, useState } from 'react';
import { submitChangeRequest } from '../lib/changeRequestApi.js';
import { createSubmissionKey } from '../lib/submissionKey.js';
import { DIALOG_FRAME_CLASS } from './FeedbackModal.jsx';
import { focusFirstError, TextAreaField, TextField } from './forms/publicForm.jsx';
import { primaryActionClass, secondaryActionClass } from './controlClasses.js';

/** The server's limits (functions/src/admin/changeRequests.cjs). */
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_PAGE_LENGTH = 200;

/**
 * @param {{ onClose: () => void, user: object|null, initialPage?: string }} props
 *   `initialPage` is the path the reader was on, offered as the page field.
 */
export default function ChangeRequestModal({ onClose, user, initialPage = '' }) {
  const titleId = useId();
  const [submissionKey] = useState(createSubmissionKey);

  const [message, setMessage] = useState('');
  const [page, setPage] = useState(() => String(initialPage ?? '').slice(0, MAX_PAGE_LENGTH));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [messageError, setMessageError] = useState(null);
  const [sent, setSent] = useState(false);

  const dialogRef = useRef(null);
  const formRef = useRef(null);
  // Read at the first render: autoFocus has moved focus into the dialog by
  // the time an effect runs (FeedbackModal.jsx).
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (typeof dialog?.showModal === 'function') dialog.showModal();
    else if (dialog) dialog.setAttribute('open', '');
    return () => {
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
    };
  }, [opener]);

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    if (!message.trim()) {
      setMessageError('Say what should change.');
      setError(null);
      // After the render that marks the field. The submit control stays
      // enabled: a dead control announces nothing.
      window.setTimeout(() => focusFirstError(formRef.current), 0);
      return;
    }
    setSubmitting(true);
    setError(null);
    setMessageError(null);
    const request = { message: message.trim(), page: page.trim() || null };
    const result = await submitChangeRequest(
      { ...request, submissionKey: submissionKey.keyFor(request) },
      { user },
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
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
              Request sent
            </h2>
            <p role="status" className="font-data text-caption text-text-secondary">
              We got your request. The event team will read it.
            </p>
            <div>
              {/* The send control is gone, so focus moves to the one
                  control left rather than dropping to the page. */}
              <button type="button" className={primaryActionClass} onClick={onClose} autoFocus>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form ref={formRef} className="flex flex-col gap-md" onSubmit={submit} noValidate>
            <h2 id={titleId} className="font-heading text-h3 font-semibold text-text-primary">
              Request a change
            </h2>

            {error ? (
              <p role="alert" className="rounded-brand border-hairline border-danger/40 bg-danger/10 px-sm py-xs font-data text-caption text-danger">
                {error}
              </p>
            ) : null}

            <TextAreaField
              label="What should change?"
              value={message}
              onChange={(next) => {
                setMessage(next);
                if (messageError && next.trim()) setMessageError(null);
              }}
              error={messageError}
              hint="Only the event team reads your request. It is stored with your sign-in address."
              rows={5}
              maxLength={MAX_MESSAGE_LENGTH}
              required
              autoFocus
            />
            <TextField
              label="Page (optional)"
              value={page}
              onChange={setPage}
              maxLength={MAX_PAGE_LENGTH}
              hint="The page the change is about."
            />

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
                {submitting ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
