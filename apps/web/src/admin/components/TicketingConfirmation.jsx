import { useEffect, useId, useRef } from 'react';
import { dangerButtonClass, Notice, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';

function tabStops(dialog) {
  return Array.from(dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')).filter((control) => {
    if (control.tabIndex < 0 || control.matches(':disabled, input[type="hidden"]') || control.closest('[hidden], [inert]')) return false;
    for (let element = control; element && element !== dialog; element = element.parentElement) {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  });
}

/** Action-time confirmation keeps keyboard focus inside and returns it to its opener. */
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
  const wrapTab = (event) => {
    if (event.defaultPrevented || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const controls = tabStops(dialogRef.current);
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = document.activeElement;
    // Native showModal keeps the background inert. Explicit boundary wrapping
    // also prevents the browser from moving Tab focus out of the document.
    if (event.shiftKey && (active === first || active === headingRef.current)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return (
    <dialog ref={dialogRef} className="ticketing-confirmation w-full max-w-2xl rounded-admin-panel border-admin-strong border-admin-rule-strong bg-admin-ground-raised p-md font-admin-ui text-admin-base text-admin-ink" aria-labelledby={headingId} aria-describedby={bodyId} onKeyDown={wrapTab} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
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
