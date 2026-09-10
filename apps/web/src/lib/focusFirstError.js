// Move focus to the first field a submit rejected.
//
// A form that refuses a submit has to say so somewhere a reader is looking.
// A message under a field is invisible to somebody at the bottom of a long
// form, and it is silent to somebody using a screen reader, because nothing
// moved and nothing was announced. Moving focus to the field does both: the
// field scrolls into view, the ring lands on it, and the field's own name,
// its state and its message are read out as one (interface guidelines,
// Accessibility: "validate on submit with aria-invalid and move focus to
// the error").
//
// This is the reason a submit control stays ENABLED while a form is invalid.
// A disabled button announces nothing. A reader who presses it and is moved
// to the field that stopped them has been told what to fix; a reader who
// presses a dead control has been told nothing at all.
//
// DOCUMENT ORDER IS THE ORDER. `querySelector` returns the first match in
// the document, which is the first error the reader would reach going down
// the page. No component has to keep a list of its fields in order.

// A field the FORM has marked, then a field the BROWSER has marked. The
// stated one comes first because a component that set it knows why; the
// native one is the safety net for a constraint nothing in React checked.
const STATED = '[aria-invalid="true"]:not([disabled])';
const NATIVE = ':invalid:not([disabled])';

/** `:invalid` is not implemented everywhere; a query must never throw. */
function firstMatch(form, selector) {
  try {
    return form.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * Focus the first invalid field inside a form.
 *
 * @param {HTMLElement|null|undefined} form the form, or any element over it
 * @returns {boolean} true when a field was found and focused
 */
export function focusFirstError(form) {
  if (!form || typeof form.querySelector !== 'function') return false;
  const field = firstMatch(form, STATED) || firstMatch(form, NATIVE);
  if (!field || typeof field.focus !== 'function') return false;
  field.focus();
  return true;
}
