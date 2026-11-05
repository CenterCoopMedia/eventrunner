import { useId, useRef } from 'react';
import { StatusBadge } from './adminChrome.jsx';
import { primaryButtonClass, secondaryButtonClass } from './formControls.jsx';
import useModalDialog, { wrapModalTab } from './useModalDialog.js';

/** Local dirtiness. Not the stored Draft / Live badge. */
export function UnsavedEditBadge() {
  return (
    <StatusBadge tone="caution" data-local-edit="unsaved">
      Unsaved changes
    </StatusBadge>
  );
}

/**
 * Stay keeps the editor mounted. Discard leaves. A running save has no Discard.
 *
 * @param {{ onStay: () => void, onDiscard: () => void, canDiscard?: boolean }} props
 */
export function UnsavedChangesDialog({ onStay, onDiscard, canDiscard = true }) {
  const stayRef = useRef(null);
  const dialogRef = useRef(null);
  const headingId = useId();
  const descriptionId = useId();
  useModalDialog(dialogRef, { initialFocusRef: stayRef });
  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      onKeyDown={wrapModalTab}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onStay(); }}
      className="admin-modal max-w-[40ch] rounded-admin-panel border-admin-strong border-admin-rule-strong bg-admin-ground-raised p-md font-admin-ui text-admin-base text-admin-ink"
    >
      <div className="grid gap-sm">
        <h2 id={headingId} className="font-admin-ui text-admin-lg font-bold text-admin-ink">
          Unsaved changes
        </h2>
        <p id={descriptionId} className="text-admin-sm text-admin-ink-secondary">
          {canDiscard
            ? 'These edits are only in this browser. Save a draft to keep them.'
            : 'A save is still running. Stay on this page until it finishes.'}
        </p>
        <div className="flex flex-wrap gap-xs">
          <button ref={stayRef} type="button" className={primaryButtonClass} onClick={onStay}>
            Stay
          </button>
          {canDiscard ? (
            <button type="button" className={secondaryButtonClass} onClick={onDiscard}>
              Discard changes
            </button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
