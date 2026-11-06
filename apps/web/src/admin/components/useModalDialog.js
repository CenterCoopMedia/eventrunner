import { useEffect } from 'react';
import { available } from '../../lib/modalFocus.js';
import './adminInteraction.css';

// Preserve existing admin imports while public dialogs use the same helper.
export { wrapModalTab } from '../../lib/modalFocus.js';

const openDialogs = [];
let bodyOverflow = '';

export default function useModalDialog(dialogRef, { initialFocusRef, returnFocusRef } = {}) {
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    if (openDialogs.length === 0) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openDialogs.push(dialog);
    dialog.showModal();
    (initialFocusRef?.current ?? dialog).focus();
    return () => {
      const wasTop = openDialogs.at(-1) === dialog;
      const index = openDialogs.indexOf(dialog);
      if (index !== -1) openDialogs.splice(index, 1);
      dialog.close();
      if (openDialogs.length === 0) document.body.style.overflow = bodyOverflow;
      if (!wasTop) return;
      // Deleting a file can remove the opener while its detail is still open.
      const fallback = returnFocusRef?.current;
      const target = available(opener) ? opener : available(fallback) ? fallback : openDialogs.at(-1);
      if (available(target)) target.focus({ preventScroll: target === opener });
    };
  }, [dialogRef, initialFocusRef, returnFocusRef]);
}
