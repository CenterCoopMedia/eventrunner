// A setting that is on or off (expansion record §3.3).
//
// It is a `role="switch"` button, not a checkbox: a switch takes effect the
// moment it is thrown, and a checkbox waits for a submit. Using the wrong
// one tells a screen reader the wrong thing about when the change lands.
//
// THE WORD IS THE STATE. `aria-checked` carries the state to assistive
// technology, and the word beside the control carries it to everybody else,
// so the state is never a shape a reader has to interpret. The label names
// the ENABLED state, always — "Send read receipts", never "Disable read
// receipts" (interface guidelines, Writing).
//
// There is no sliding knob. A knob is a shape that has to travel to say
// what it means, and the system's answer to a state is a word and a ground.
// The control is the shared rectangle with the state grammar on it: the
// filled ground says on, the ruled ground says off, and the word under the
// label says which in language.
import { useId } from 'react';
import { controlStateClass } from '../controlClasses.js';

const trackClass =
  `${controlStateClass} touch-target inline-flex items-center justify-center rounded-brand ` +
  'border-hairline border-control px-md py-xs font-data text-caption font-semibold ' +
  'text-text-primary aria-checked:border-accent aria-checked:bg-accent aria-checked:text-surface';

/**
 * @param {object} props
 * @param {string} props.label the setting, named by its enabled state
 * @param {boolean} props.checked
 * @param {(next: boolean) => void} props.onChange
 * @param {string} [props.hint] one line under the label
 * @param {boolean} [props.disabled] states unavailable; keeps the tab order
 * @param {[string, string]} [props.stateWords] the off and on words
 */
export default function Switch({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
  stateWords = ['Off', 'On'],
}) {
  const labelId = useId();
  const hintId = `${labelId}-hint`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-sm">
      <span className="flex flex-col gap-3xs">
        <span id={labelId} className="font-data text-caption font-semibold text-text-primary">
          {label}
        </span>
        {hint ? (
          <span id={hintId} className="text-caption text-text-secondary">
            {hint}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
        className={trackClass}
      >
        {checked ? stateWords[1] : stateWords[0]}
      </button>
    </div>
  );
}
