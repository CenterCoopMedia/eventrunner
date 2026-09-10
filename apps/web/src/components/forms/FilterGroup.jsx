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

  function toggle(value) {
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );
  }

  return (
    <fieldset className="flex flex-col gap-xs border-t-hairline border-rule-hairline pt-sm">
      <legend className="font-data text-caption font-semibold text-text-primary">
        {legend}
        {active > 0 ? (
          <span className="font-normal text-text-secondary"> — {active} on</span>
        ) : null}
      </legend>
      <div className="flex flex-col">
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
          <button type="button" className={quietActionClass} onClick={() => onChange([])}>
            {clearLabel}
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
