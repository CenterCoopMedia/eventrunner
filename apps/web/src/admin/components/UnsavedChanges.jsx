import { useEffect, useRef } from 'react';
import { StatusBadge } from './adminChrome.jsx';
import { primaryButtonClass, secondaryButtonClass } from './formControls.jsx';

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
  useEffect(() => {
    stayRef.current?.focus();
  }, []);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
      className="fixed inset-0 z-50 grid place-items-center bg-admin-ink/40 p-md"
    >
      <div className="grid max-w-[40ch] gap-sm rounded-admin border-admin-rule-strong bg-admin-ground-raised p-md">
        <h2 id="unsaved-changes-title" className="font-admin-ui text-admin-lg font-bold text-admin-ink">
          Unsaved changes
        </h2>
        <p className="text-admin-sm text-admin-ink-secondary">
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
    </div>
  );
}
