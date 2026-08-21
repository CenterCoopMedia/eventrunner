// The dialog shell the three media modals share.
//
// Interface guidelines applied: the dialog is labelled by its own heading,
// focus moves into it on open and returns to whatever opened it on close,
// Escape closes, the backdrop is inert to clicks that started inside the
// panel, and the page behind it stops scrolling. No dependency: the app has
// no dialog library and one modal shell does not justify adding one.
import { useEffect, useId, useRef } from 'react';

export default function ModalShell({ title, description = null, onClose, children }) {
  const headingId = useId();
  const panelRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-brand-ink/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="my-8 w-full max-w-3xl rounded-brand-lg border border-brand-ink/10 bg-brand-surface p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={headingId} className="font-heading text-xl font-semibold text-brand-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-brand-ink-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="touch-target rounded-brand px-3 py-2 text-brand-ink hover:bg-brand-surface-alt"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
