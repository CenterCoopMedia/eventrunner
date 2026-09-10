// Order a list (expansion record §3.3).
//
// It is a labelled `<select>`, and the label is a real label rather than a
// placeholder option. A sort order is one choice from a set a reader does
// not need to see all at once, which is what a select is for; a segmented
// control would spend a whole row of the page on it.
//
// The label states what is being ordered, so a reader who lands on the
// control out of context still knows: "Sort sessions", never "Sort by".
import { useId } from 'react';
import { inputClass } from '../controlClasses.js';

/**
 * @param {object} props
 * @param {string} props.label what the order applies to
 * @param {Array<{ value: string, label: string }>} props.options
 * @param {string} props.value
 * @param {(next: string) => void} props.onChange
 */
export default function SortControl({ label, options, value, onChange }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2xs">
      <label htmlFor={id} className="font-data text-caption font-semibold text-text-primary">
        {label}
      </label>
      <select
        id={id}
        className={`${inputClass} sm:w-auto`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
