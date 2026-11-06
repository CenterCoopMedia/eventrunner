/** Whether an element can receive focus in the currently visible document. */
export function available(element) {
  if (!element?.isConnected || typeof element.focus !== 'function' || element.matches(':disabled') || element.closest('[hidden], [inert]')) return false;
  for (let node = element; node; node = node.parentElement) {
    if (node.tagName === 'DIALOG' && !node.open) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

/**
 * Native modality makes the background inert. Wrap only the Tab boundaries
 * so focus stays in the document instead of moving into browser controls.
 * Native traversal still handles the controls between those boundaries.
 */
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
    return;
  }

  // A receipt heading or error summary can hold programmatic focus without
  // joining the Tab order. Respect its document position: Shift+Tab before
  // the first control wraps to the last; Tab after the last wraps forward.
  const outsideTabOrder = active !== dialog && dialog.contains(active) && !controls.includes(active);
  const beforeFirst = outsideTabOrder && Boolean(active.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
  const afterLast = outsideTabOrder && Boolean(active.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_PRECEDING);
  if (event.shiftKey && (active === first || active === dialog || beforeFirst)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || active === dialog || afterLast)) {
    event.preventDefault();
    first.focus();
  }
}
