// The dialog shell the three media modals share.
//
// Interface guidelines applied: the dialog is labelled by its own heading,
// focus moves into it on open and returns to whatever opened it on close,
// Escape closes, and the page behind it stops scrolling. No dependency: the
// app has no dialog library and one modal shell does not justify adding one.
//
// Elevation (design brief §2.1, §2.4): the ink-tinted overlay (no blur) is
// the scrim, and a strong-rule frame carries the panel — never a shadow.
// "Shadow decorates nothing" is absolute; a modal is lifted by tint, not by
// depth.
//
// Escape closes ONE dialog — the topmost. These modals nest: ImagePicker
// opens a library, and a tile inside it opens the asset detail dialog. With
// every mounted shell handling the same document-level keydown, one Escape
// would collapse the whole stack and throw away the picker the person was
// only stepping out of. A module-level stack of open shells decides which
// handler acts; the rest ignore the key.
import { useEffect, useId, useRef } from 'react';

/** Open shells, oldest first. The last entry is the topmost dialog. */
const openShells = [];

export default function ModalShell({ title, description = null, onClose, children }) {
  const headingId = useId();
  const panelRef = useRef(null);
  const openerRef = useRef(null);

  // The token identifies THIS shell in the stack for its whole lifetime.
  const tokenRef = useRef(null);
  if (tokenRef.current === null) tokenRef.current = Symbol('modal');

  // Registration is mount/unmount ONLY. Re-registering on every render (an
  // `onClose` identity that changes with a parent re-render) would move a
  // parent shell back to the top of the stack while its own child dialog is
  // still open, and Escape would then close the wrong one.
  useEffect(() => {
    const token = tokenRef.current;
    openShells.push(token);
    openerRef.current = document.activeElement;
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      const index = openShells.indexOf(token);
      if (index !== -1) openShells.splice(index, 1);
      // A parent shell keeps the page locked; only the last one out
      // restores scrolling.
      if (openShells.length === 0) document.body.style.overflow = previousOverflow;
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, []);

  useEffect(() => {
    const token = tokenRef.current;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      // Only the topmost dialog answers, and it stops the event so a
      // handler mounted outside this component cannot also act on it.
      if (openShells[openShells.length - 1] !== token) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-brand-ink/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="my-8 w-full max-w-3xl rounded-brand-lg border-strong border-rule-strong bg-brand-surface p-6"
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
