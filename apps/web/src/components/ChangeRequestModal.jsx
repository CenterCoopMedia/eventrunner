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
import { PublicLink as Link } from './PublicLink.jsx';
import { submitChangeRequest } from '../lib/changeRequestApi.js';
import { createSubmissionKey } from '../lib/submissionKey.js';
import { markChangeRequestSent } from '../lib/changeRequestMarker.js';
import { wrapModalTab } from '../lib/modalFocus.js';
import { DIALOG_FRAME_CLASS } from './FeedbackModal.jsx';
import { focusFirstError, TextAreaField, TextField } from './forms/publicForm.jsx';
import { primaryActionClass, secondaryActionClass } from './controlClasses.js';
import BusyLabel from './BusyLabel.jsx';
import { useScreenshotFiles } from '@screenshot-ui/ScreenshotField.jsx';
import { encodeScreenshots, SIGNED_IN_SCREENSHOT_MIB } from '@screenshot-ui/browser.mjs';
import PublicScreenshotField from './forms/PublicScreenshotField.jsx';
import { DraftDismissalPrompt, useWritingDialogDraft } from './WritingDialogDraft.jsx';

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
  const submissionStateRef = useRef('idle');

  const [message, setMessage] = useState('');
  const [initialPageValue] = useState(() => String(initialPage ?? '').slice(0, MAX_PAGE_LENGTH));
  const [page, setPage] = useState(initialPageValue);
  const screenshots = useScreenshotFiles(SIGNED_IN_SCREENSHOT_MIB);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [messageError, setMessageError] = useState(null);
  const [sent, setSent] = useState(false);

  const dialogRef = useRef(null);
  const formRef = useRef(null);
  const draft = useWritingDialogDraft({
    dialogRef,
    submissionStateRef,
    dirty: message !== '' || page !== initialPageValue || screenshots.files.length > 0,
    onClose,
  });
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
    if (submissionStateRef.current !== 'idle' || draft.confirming) return;
    if (!message.trim()) {
      setMessageError('Say what should change.');
      setError(null);
      // After the render that marks the field. The submit control stays
      // enabled: a dead control announces nothing.
      window.setTimeout(() => focusFirstError(formRef.current), 0);
      return;
    }
    submissionStateRef.current = 'pending';
    setSubmitting(true);
    setError(null);
    setMessageError(null);
    const request = { message: message.trim(), page: page.trim() || null };
    let result;
    try {
      result = await submitChangeRequest({
        ...request,
        ...(screenshots.files.length ? await encodeScreenshots(screenshots.files) : {}),
        submissionKey: submissionKey.keyFor({ ...request, files: screenshots.files.map(({ id }) => id) }),
      }, { user });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    draft.restoreDialog();
    submissionStateRef.current = result.ok ? 'sent' : 'idle';
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    markChangeRequestSent(user?.uid);
    setSent(true);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={`public-dialog motion-enter ${DIALOG_FRAME_CLASS}`}
      onKeyDown={wrapModalTab}
      onCancel={draft.handleCancel}
      onClose={draft.handleNativeClose}
    >
      <div className="flex flex-col gap-md">
        {!sent ? (
          <h2 id={titleId} className="font-heading text-h3 font-semibold text-text-primary">
            Request a change
          </h2>
        ) : null}
        {sent ? (
          <div className="flex flex-col gap-md">
            <h2 id={titleId} className="font-heading text-h3 font-semibold text-text-primary">
              Request sent
            </h2>
            <p role="status" className="font-data text-caption text-text-secondary">
              We got your request. The event team will read it.
            </p>
            <p className="font-data text-caption text-text-secondary">
              {/* Issue #330: the reader can follow the request. The dialog
                  closes on the way, so it does not sit over the next page. */}
              <Link to="/profile/change-requests" className="underline" onClick={onClose}>
                See your change requests
              </Link>
            </p>
            <div>
              {/* The send control is gone, so focus moves to the one
                  control left rather than dropping to the page. */}
              <button type="button" className={primaryActionClass} onClick={draft.requestDismissal} autoFocus>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form ref={formRef} hidden={draft.confirming} className={draft.confirming ? undefined : 'flex flex-col gap-md'} onSubmit={submit}
            onPaste={submitting ? undefined : screenshots.onPaste} noValidate>
            {error ? (
              <p role="alert" className="rounded-brand border-hairline border-danger/40 bg-danger/10 px-sm py-xs font-data text-caption text-danger">
                {error}
              </p>
            ) : null}

            <TextAreaField
              label="What should change?"
              value={message}
              onChange={(next) => {
                if (submissionStateRef.current !== 'idle') return;
                setMessage(next);
                if (messageError && next.trim()) setMessageError(null);
              }}
              error={messageError}
              hint="Only the event team reads your request. It is stored with your sign-in address."
              rows={5}
              maxLength={MAX_MESSAGE_LENGTH}
              readOnly={submitting}
              required
              autoFocus
            />
            <TextField
              label="Page (optional)"
              value={page}
              onChange={(next) => {
                if (submissionStateRef.current === 'idle') setPage(next);
              }}
              maxLength={MAX_PAGE_LENGTH}
              hint="The page the change is about."
              readOnly={submitting}
            />
            <PublicScreenshotField selection={screenshots} disabled={submitting} />

            <div className="flex flex-wrap justify-end gap-xs">
              <button type="button" className={secondaryActionClass} aria-disabled={submitting || undefined} onClick={draft.requestDismissal}>
                Cancel
              </button>
              {/* State the busy action immediately. The control keeps focus
                  while the request runs; submit() refuses a second press. */}
              <button
                type="submit"
                className={primaryActionClass}
                aria-disabled={submitting || undefined}
                aria-busy={submitting || undefined}
              >
                <BusyLabel busy={submitting} pending="Sending your request…">Send request</BusyLabel>
              </button>
            </div>
          </form>
        )}
        {draft.confirming ? <DraftDismissalPrompt draft={draft} /> : null}
      </div>
    </dialog>
  );
}
