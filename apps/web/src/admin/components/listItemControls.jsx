import { forwardRef, useEffect, useId, useRef } from 'react';
import { dangerButtonClass, secondaryButtonClass } from './formControls.jsx';

// The add and remove controls of a repeated list in a settings form (issue
// #475): one compact add control in the panel heading, and one remove
// control inside each item, in that item's heading. The remove control says
// "Remove" on screen and names its item to a screen reader ("Remove day 2,
// Workshops"), so it can never be read as removing some other record. Every
// control keeps the full control height: compact means fewer words, not a
// smaller target.

/** "+ Add day": the plus is a mark for the eye; the name is the words. */
export const AddItemButton = forwardRef(function AddItemButton({ children, onClick }, ref) {
  return (
    <button ref={ref} type="button" className={secondaryButtonClass} onClick={onClick}>
      <span aria-hidden="true" className="font-bold">+</span>
      {children}
    </button>
  );
});

/**
 * The item's own remove control. `name` is the full accessible name; it
 * starts with the visible word, so speech input can say "Remove".
 */
export const RemoveItemButton = forwardRef(function RemoveItemButton({ name, onClick }, ref) {
  return (
    <button ref={ref} type="button" className={`${dangerButtonClass} px-sm`} aria-label={name} onClick={onClick}>
      <span aria-hidden="true">×</span>
      Remove
    </button>
  );
});

/**
 * "Used by 3 sessions: A, B and C." — the records that point at an item,
 * four by name and the rest as a count.
 *
 * @param {string[]} uses
 */
export function usageSentence(uses) {
  if (!uses?.length) return '';
  const named = uses.slice(0, 4);
  const more = uses.length - named.length;
  const list = more > 0
    ? `${named.join(', ')} and ${more} more`
    : named.length > 1
      ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
      : named[0];
  return `Used by ${uses.length} session${uses.length === 1 ? '' : 's'}: ${list}.`;
}

/**
 * The still surface that states what a removal does before it happens: the
 * alarm ground, a question as its name, the consequence in words, and two
 * labelled answers. Focus moves onto it when it opens, so a screen reader
 * reads the consequence first.
 */
export function RemovalWarning({ title, consequence, confirmLabel, keepLabel, onConfirm, onKeep }) {
  const headingId = useId();
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div
      ref={ref}
      role="group"
      tabIndex={-1}
      aria-labelledby={headingId}
      className="mt-sm flex flex-col gap-xs rounded-admin border-admin-alarm border-admin-rule-alarm bg-admin-ground-alarm px-md py-sm"
    >
      <p id={headingId} className="text-admin-base font-bold text-admin-state-error">{title}</p>
      <p className="max-w-[65ch] text-admin-sm text-admin-ink">{consequence}</p>
      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={dangerButtonClass} onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className={secondaryButtonClass} onClick={onKeep}>{keepLabel}</button>
      </div>
    </div>
  );
}

/** Run after React has drawn the change, so the control to focus exists. */
export function afterRender(callback) {
  setTimeout(callback, 0);
}
