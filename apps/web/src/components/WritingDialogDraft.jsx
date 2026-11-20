import { useId, useLayoutEffect, useRef, useState } from 'react';
import { primaryActionClass, secondaryActionClass } from './controlClasses.js';

function focusMessage(dialog) {
  dialog?.querySelector('textarea')?.focus({ preventScroll: true });
}

export function useWritingDialogDraft({ dialogRef, submissionStateRef, dirty, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef(null);
  const returningToForm = useRef(false);

  useLayoutEffect(() => {
    if (confirming) {
      keepRef.current?.focus();
    } else if (returningToForm.current) {
      returningToForm.current = false;
      focusMessage(dialogRef.current);
    }
  }, [confirming, dialogRef]);

  function requestDismissal() {
    if (submissionStateRef.current === 'pending') return false;
    if (submissionStateRef.current !== 'sent' && dirty) {
      setConfirming(true);
      return false;
    }
    onClose();
    return true;
  }

  // The browser queues the close event. A send can settle after the dialog
  // closes and before that event arrives, so the completion path restores it too.
  function restoreDialog() {
    const dialog = dialogRef.current;
    if (!dialog?.isConnected || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (keepRef.current) keepRef.current.focus();
    else focusMessage(dialog);
  }

  function handleNativeClose(event) {
    const dialog = event.currentTarget;
    if (dialog.isConnected && !dialog.open && !requestDismissal()) restoreDialog();
  }

  function handleCancel(event) {
    event.preventDefault();
    requestDismissal();
  }

  function keepWriting() {
    returningToForm.current = true;
    setConfirming(false);
  }

  function discardDraft() {
    if (submissionStateRef.current !== 'pending') onClose();
  }

  return { confirming, requestDismissal, restoreDialog, handleNativeClose, handleCancel, keepRef, keepWriting, discardDraft };
}

export function DraftDismissalPrompt({ draft }) {
  const promptId = useId();

  return (
    <div className="flex flex-col gap-md">
      <p id={promptId}>Discard your draft?</p>
      <div className="flex flex-wrap justify-end gap-xs">
        <button ref={draft.keepRef} type="button" className={primaryActionClass} aria-describedby={promptId} onClick={draft.keepWriting}>
          Keep writing
        </button>
        <button type="button" className={secondaryActionClass} onClick={draft.discardDraft}>
          Discard draft
        </button>
      </div>
    </div>
  );
}
