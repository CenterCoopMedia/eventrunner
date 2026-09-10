// One choice from a short set (expansion record §3.3).
//
// It is a radio group — `role="radiogroup"` over `role="radio"` buttons —
// set as ONE RULED ROW of words. A reader sees every choice at once, which
// is what separates it from a select: a select hides the set until it is
// opened, so it suits a long list and never a short one.
//
// THE SET HOLDS ONE TAB STOP. Tab reaches the group, the arrow keys move
// inside it, and Home and End reach the ends. That is the radio group's own
// keyboard, and a reader who has met one radio group has met this one.
//
// The chosen word sits on the filled ground AND takes the bold weight, so
// the state is never colour alone. The row is a rectangle on the theme
// radius; it is never a pill.
import { useId, useRef } from 'react';
import { controlStateClass } from '../controlClasses.js';
import { nextRovingIndex } from './rovingKeys.js';

const optionClass =
  `${controlStateClass} segmented__option touch-target inline-flex items-center justify-center ` +
  'px-md py-xs font-data text-caption font-medium text-text-primary';

/**
 * @param {object} props
 * @param {string} props.label the group's own name
 * @param {Array<{ value: string, label: string }>} props.options
 * @param {string} props.value
 * @param {(next: string) => void} props.onChange
 * @param {boolean} [props.hideLabel] render the legend for readers only
 */
export default function SegmentedControl({ label, options, value, onChange, hideLabel = false }) {
  const labelId = useId();
  const rowRef = useRef(null);

  const current = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  function onKeyDown(event) {
    const index = nextRovingIndex(event.key, current, options.length);
    if (index === null) return;
    event.preventDefault();
    onChange(options[index].value);
    // Focus follows the selection, which is what a radio group does: the
    // arrow key both moves and chooses.
    rowRef.current?.querySelectorAll('[role="radio"]')[index]?.focus();
  }

  // `items-start` matters: the row is an inline-flex, and a stretching column
  // would pull its last option out to the full width of the page, which reads
  // as a bar rather than as a set of words.
  return (
    <div className="flex flex-col items-start gap-2xs">
      <span
        id={labelId}
        className={
          hideLabel ? 'sr-only' : 'font-data text-caption font-semibold text-text-primary'
        }
      >
        {label}
      </span>
      <div
        ref={rowRef}
        role="radiogroup"
        aria-labelledby={labelId}
        className="segmented"
        onKeyDown={onKeyDown}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            tabIndex={index === current ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={optionClass}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
