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
// THE STOP FOLLOWS FOCUS (adversarial review of the 2026-09-10 wave). An
// unavailable option can hold focus without being chosen, and a stop pinned
// to the chosen option would send Tab and Shift+Tab from that focused option
// back into the row. So the row remembers which option holds focus and gives
// that one the stop, falling back to the chosen option when focus is
// elsewhere; exactly one option has tabindex 0 at any time.
//
// The chosen word sits on the filled ground AND takes the bold weight, so
// the state is never colour alone. The row is a rectangle on the theme
// radius; it is never a pill.
import { useId, useRef, useState } from 'react';
import { controlStateClass } from '../controlClasses.js';
import { nextRovingIndex } from './rovingKeys.js';

const optionClass =
  `${controlStateClass} segmented__option touch-target inline-flex items-center justify-center ` +
  'px-md py-xs font-data text-caption font-medium text-text-primary';

/**
 * AN UNAVAILABLE OPTION STAYS IN THE ROW AND EXPLAINS ITSELF (expansion
 * record §2.1). It carries `aria-disabled="true"` rather than `disabled`,
 * so the arrow keys can still land on it and a screen reader hears that it
 * is unavailable and why — `hint` is read as part of the option's name —
 * and its handler refuses every activation path: a click goes nowhere and
 * the arrow keys move focus onto it without choosing it. A sighted reader
 * sees it too: the stylesheet draws a dashed rule under the word, and the
 * hint is shown under the row while the option has focus or the pointer.
 * A set with no choice left is not rendered; this is for a choice that
 * exists and cannot be taken yet.
 *
 * @param {object} props
 * @param {string} props.label the group's own name
 * @param {Array<{ value: string, label: string, disabled?: boolean, hint?: string }>} props.options
 * @param {string} props.value
 * @param {(next: string) => void} props.onChange
 * @param {boolean} [props.hideLabel] render the legend for readers only
 */
export default function SegmentedControl({ label, options, value, onChange, hideLabel = false }) {
  const labelId = useId();
  const rowRef = useRef(null);
  // The option that holds focus, or null when focus is outside the row, and
  // the one under the pointer. The stop follows the first; the reason line
  // under the row follows either.
  const [focused, setFocused] = useState(null);
  const [hovered, setHovered] = useState(null);

  const current = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const stop = focused ?? current;

  function onKeyDown(event) {
    const index = nextRovingIndex(event.key, stop, options.length);
    if (index === null) return;
    event.preventDefault();
    // Focus follows the key, which is what a radio group does: the arrow
    // key both moves and chooses — unless the option it lands on states it
    // is unavailable, and then it only moves.
    rowRef.current?.querySelectorAll('[role="radio"]')[index]?.focus();
    if (options[index].disabled) return;
    onChange(options[index].value);
  }

  function onBlur(event) {
    // Focus left the row: the stop returns to the chosen option.
    if (rowRef.current?.contains(event.relatedTarget)) return;
    setFocused(null);
  }

  const shown = options[hovered ?? focused ?? -1];
  const reason = shown?.disabled && shown.hint ? shown.hint : null;

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
        onBlur={onBlur}
        onMouseLeave={() => setHovered(null)}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            aria-disabled={option.disabled || undefined}
            tabIndex={index === stop ? 0 : -1}
            onFocus={() => setFocused(index)}
            onMouseEnter={() => setHovered(index)}
            onClick={() => {
              if (!option.disabled) onChange(option.value);
            }}
            className={optionClass}
          >
            {option.label}
            {option.disabled && option.hint ? <span className="sr-only">{` (${option.hint})`}</span> : null}
          </button>
        ))}
      </div>
      {/* The unavailable option's reason, drawn for a sighted reader while
          that option has focus or the pointer. Assistive technology already
          has it in the option's name. */}
      {reason ? (
        <p aria-hidden="true" className="segmented__reason font-data text-caption text-text-secondary">
          {reason}
        </p>
      ) : null}
    </div>
  );
}
