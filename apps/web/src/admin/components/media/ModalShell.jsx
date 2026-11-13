// The dialog shell the three media modals share (admin-only: MediaLibrary,
// AssetModal, UploadModal, and ImagePicker all live here — design brief
// §5.2, admin story part 2 "the cut file"). A public-facing photo field
// (ProfilePhotoField, SpeakerPhotoField) never opens one of these; they stay
// on ../../../components/media/AssetImage.jsx instead.
//
// Interface guidelines applied: the dialog is labelled by its own heading,
// focus moves into it on open and returns to whatever opened it on close,
// Escape closes, and the page behind it stops scrolling. No dependency: the
// app has no dialog library and one modal shell does not justify adding one.
//
// Elevation (admin story part 6, brief §5.2 open question 4): the scrim is a
// tinted-ink overlay, never a blur, and a strong-rule frame carries the
// panel — never a shadow. No `--admin-shadow-*` family exists; a modal is
// lifted by tint and rule, not by depth.
//
// Native dialogs keep the page inert, including when ImagePicker opens an
// asset detail on top of its library. Only the topmost receives cancel.
// Pending writes use the same dismissal guard for Escape, X, and Cancel.
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { secondaryButtonClass } from '../formControls.jsx';
import AdminIconControl from '../AdminIconControl.jsx';
import useModalDialog, { wrapModalTab } from '../useModalDialog.js';

export default function ModalShell({ title, description = null, onClose, busy = false, returnFocusRef, children }) {
  const headingId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  useModalDialog(panelRef, { returnFocusRef });

  return createPortal(
      <dialog
        ref={panelRef}
        aria-labelledby={headingId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="admin-modal max-w-3xl rounded-admin-panel border-admin-strong border-admin-rule-strong bg-admin-ground-raised p-md font-admin-ui text-admin-base text-admin-ink"
        onKeyDown={wrapModalTab}
        // Keep dialog forms outside page forms in the DOM. Portal events
        // still bubble through React, so stop them before the page handler.
        onSubmit={(event) => event.stopPropagation()}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) onClose();
        }}
      >
        <div className="flex items-start justify-between gap-sm">
          <div className="min-w-0">
            <h2 id={headingId} className="text-admin-xl font-bold text-admin-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-3xs text-admin-sm text-admin-ink-secondary">{description}</p>
            ) : null}
          </div>
          <AdminIconControl
            onClick={() => { if (!busy) onClose(); }}
            label="Close"
            icon="close"
            title="Close dialog"
            disabled={busy}
            className={`${secondaryButtonClass} min-w-[var(--admin-control-height)] shrink-0`}
          />
        </div>
        <div className="mt-sm">{children}</div>
      </dialog>,
    document.body,
  );
}
