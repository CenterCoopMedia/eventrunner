// Narrow a list by a facet (expansion record §3.3).
//
// It is a real `<fieldset>` with a real `<legend>`, so the facet's name is
// carried to a screen reader by the element that exists for it, rather than
// by a heading that happens to sit above the boxes.
//
// THE COUNT IS PART OF THE LEGEND. A reader who scrolls past a filter group
// and back needs to know whether it is doing anything, and a set of boxes
// only answers that by being read one at a time. The count answers it in one
// glance and in one announcement, and the clear control beside it is the way
// back — one control, never one per box.
//
// The clear control renders only when something is on. A control that
// clears nothing is a dead end (interface guidelines, Writing).
//
// CLEARING MOVES FOCUS TO THE FIRST BOX. The control exists only while
// something is on, so clearing removes the control — and an element removed
// while it holds focus drops focus to the body, which sends a keyboard
// reader back to the start of the page. The head of the group is where the
// reader would work next, so the first box takes focus before the control
// goes. The box is found in the group's own boxes rather than held as a ref
// per option, the same way the tab row finds its tabs. It is the first
// ENABLED box: `focus()` on a disabled input does nothing, so a disabled
// first box would drop the reader on the body after all.
import { useRef } from 'react';
import { Checkbox } from './Choice.jsx';
import { quietActionClass } from '../controlClasses.js';

/**
 * @param {object} props
 * @param {string} props.legend the facet's name
 * @param {Array<{ value: string, label: string, count?: number }>} props.options
 * @param {string[]} props.selected
 * @param {(next: string[]) => void} props.onChange
 * @param {string} [props.clearLabel] the clear control's own words
 */
export default function FilterGroup({
  legend,
  options,
  selected,
  onChange,
  clearLabel = 'Clear filter',
}) {
  const active = selected.length;
  const boxesRef = useRef(null);

  function toggle(value) {
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );
  }

  function clear() {
    // The box is focused first: React removes the control in the render
    // this state change causes, and by then the reader is already on the
    // group rather than on nothing.
    boxesRef.current?.querySelector('input[type="checkbox"]:not([disabled])')?.focus();
    onChange([]);
  }

  return (
    <fieldset className="flex flex-col gap-xs border-t-hairline border-rule-hairline pt-sm">
      <legend className="font-data text-caption font-semibold text-text-primary">
        {legend}
        {active > 0 ? (
          <span className="font-normal text-text-secondary"> — {active} on</span>
        ) : null}
      </legend>
      <div ref={boxesRef} className="flex flex-col">
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={
              option.count === undefined ? option.label : `${option.label} (${option.count})`
            }
            checked={selected.includes(option.value)}
            onChange={() => toggle(option.value)}
          />
        ))}
      </div>
      {active > 0 ? (
        <div>
          <button type="button" className={quietActionClass} onClick={clear}>
            {clearLabel}
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
