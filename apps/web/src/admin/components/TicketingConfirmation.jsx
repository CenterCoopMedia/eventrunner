import { useEffect, useId, useRef } from 'react';
import { dangerButtonClass, Notice, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';

/** Action-time confirmation uses the platform focus trap and returns focus to its opener. */
export default function TicketingConfirmation({ title, children, confirmLabel, onConfirm, onClose, busy, error, destructive = false }) {
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  const headingId = useId();
  const bodyId = useId();
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    headingRef.current?.focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog ref={dialogRef} className="ticketing-confirmation w-full max-w-2xl rounded-admin-panel border-admin-strong border-admin-rule-strong bg-admin-ground-raised p-md font-admin-ui text-admin-base text-admin-ink" aria-labelledby={headingId} aria-describedby={bodyId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form className="space-y-md" onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm(); }}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-admin-xl font-bold">{title}</h2>
        <div id={bodyId} className="space-y-sm">{children}</div>
        {error ? <Notice tone="error" message={error} /> : null}
        <div className="flex flex-wrap gap-sm">
          <button type="submit" className={destructive ? dangerButtonClass : primaryButtonClass} aria-busy={busy} aria-disabled={busy}>{busy ? 'Saving…' : confirmLabel}</button>
          <button type="button" className={secondaryButtonClass} aria-disabled={busy} onClick={() => { if (!busy) onClose(); }}>Go back</button>
        </div>
      </form>
    </dialog>
  );
}
