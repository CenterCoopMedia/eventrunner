import { useEffect } from 'react';
import './adminInteraction.css';

const openDialogs = [];
let bodyOverflow = '';

function available(element) {
  if (!element?.isConnected || typeof element.focus !== 'function' || element.matches(':disabled') || element.closest('[hidden], [inert]')) return false;
  for (let node = element; node; node = node.parentElement) {
    if (node.tagName === 'DIALOG' && !node.open) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

/** Native modality makes the background inert; explicit boundary wrapping keeps Tab in the document. */
export function wrapModalTab(event) {
  if (event.defaultPrevented || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
  const dialog = event.currentTarget;
  // A nested modal handles its own boundaries.
  if (event.target.closest('dialog') !== dialog) return;
  const controls = Array.from(dialog.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]'))
    .filter((control) => control.tabIndex >= 0 && !control.matches('input[type="hidden"]') && available(control) && control.closest('dialog') === dialog);
  const first = controls[0];
  const last = controls.at(-1);
  const active = document.activeElement;
  if (!first) {
    event.preventDefault();
    dialog.focus();
  } else if (event.shiftKey && (active === first || !controls.includes(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !controls.includes(active))) {
    event.preventDefault();
    first.focus();
  }
}

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
