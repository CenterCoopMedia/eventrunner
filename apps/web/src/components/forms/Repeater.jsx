// Repeater — a short list of rows a person adds and removes (expansion
// record §3.3).
//
// Links on a profile, shuttle times on a travel page, the handles a speaker
// lists. Each row's fields are the caller's and every one of them is
// labelled; what the repeater owns is the list, the add control under it,
// the remove control on each row, and where focus goes when a row comes or
// goes, so the whole thing can be worked from the keyboard.
//
// FOCUS FOLLOWS THE CHANGE. A row that is added takes focus on its first
// field, because that is where the reader would type next. A row that is
// removed hands focus to the row before it, or to the add control when it
// was the last one — an element removed while it holds focus drops focus to
// the body, which sends a keyboard reader to the top of the page.
//
// A REMOVE CONTROL NAMES ITS ROW. "Remove" six times is six identical
// buttons to a screen reader; "Remove link 2" is not.
import { useEffect, useRef } from 'react';
import { quietActionClass } from '../controlClasses.js';

/**
 * @param {object} props
 * @param {string} props.legend the list's name
 * @param {Array<{ id: string }>} props.rows
 * @param {(row: object, index: number) => import('react').ReactNode} props.renderRow
 * @param {() => void} props.onAdd
 * @param {(id: string) => void} props.onRemove
 * @param {string} [props.addLabel]
 * @param {string} [props.rowName] the noun a remove control names: "link"
 * @param {number} [props.max] rows the list may hold; the add control goes
 *   when it is reached, and the legend says so
 * @param {string} [props.emptyLine] what the list says with no row in it
 */
export default function Repeater({
  legend,
  rows,
  renderRow,
  onAdd,
  onRemove,
  addLabel = 'Add another',
  rowName = 'row',
  max,
  emptyLine,
}) {
  const listRef = useRef(null);
  const addRef = useRef(null);
  const previousCount = useRef(rows.length);
  // Set by the remove handler, read by the effect that runs after React
  // has taken the row out of the document.
  const focusAfterRemove = useRef(null);

  useEffect(() => {
    const count = rows.length;
    if (count > previousCount.current) {
      // A new row: its first field takes focus.
      const items = listRef.current?.querySelectorAll('.repeater__row') ?? [];
      items[items.length - 1]?.querySelector('input, select, textarea')?.focus();
    } else if (count < previousCount.current && focusAfterRemove.current !== null) {
      const items = listRef.current?.querySelectorAll('.repeater__row') ?? [];
      const target = items[Math.min(focusAfterRemove.current, items.length - 1)];
      if (target) target.querySelector('input, select, textarea, button')?.focus();
      else addRef.current?.focus();
      focusAfterRemove.current = null;
    }
    previousCount.current = count;
  }, [rows.length]);

  const full = Number.isFinite(max) && rows.length >= max;

  return (
    <fieldset className="repeater flex flex-col gap-xs">
      <legend className="font-data text-caption font-semibold text-text-primary">
        {legend}
        {Number.isFinite(max) ? (
          <span className="font-normal text-text-secondary">
            {' '}
            — {rows.length} of {max}
          </span>
        ) : null}
      </legend>
      {rows.length === 0 && emptyLine ? (
        <p className="text-caption text-text-secondary">{emptyLine}</p>
      ) : null}
      <ol ref={listRef} className="flex flex-col">
        {rows.map((row, index) => (
          <li key={row.id} className="repeater__row flex flex-wrap items-end gap-sm">
            <div className="min-w-0 flex-1">{renderRow(row, index)}</div>
            <button
              type="button"
              className={quietActionClass}
              aria-label={`Remove ${rowName} ${index + 1}`}
              onClick={() => {
                focusAfterRemove.current = Math.max(0, index - 1);
                onRemove(row.id);
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      {full ? null : (
        <div>
          <button ref={addRef} type="button" className={quietActionClass} onClick={onAdd}>
            {addLabel}
          </button>
        </div>
      )}
    </fieldset>
  );
}
