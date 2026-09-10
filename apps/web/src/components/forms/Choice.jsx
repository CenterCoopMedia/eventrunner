// The checkbox and the radio, on the token system (expansion record §3.3).
//
// A native checkbox and a native radio are painted by the operating system.
// A client's palette stops at their edge, dark mode stops at their edge, and
// the two modes disagree about what a checked control looks like. So the
// native paint is turned off (`.control-choice` in index.css, which sets
// `appearance: none`) and the control is redrawn from the tokens.
//
// THE INPUT IS STILL THE INPUT. `appearance: none` removes the paint, not
// the element: the keyboard path, the label association, the name and value,
// the arrow keys inside a radio group, and the form's own submit all stay
// exactly as the browser implements them. Nothing here reimplements a
// behaviour the platform already owns.
//
// The mark is an inline SVG reading `currentColor`, so it takes the ink of
// the ground it lands on and needs no colour token of its own. It sits over
// the input and never intercepts the pointer, so a click anywhere on the
// control still reaches the input under it.
import { useId } from 'react';

/** The check, drawn as two strokes. */
function CheckMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="pointer-events-none absolute inset-0 opacity-0 peer-checked:opacity-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

/** The radio's centre, drawn as one dot. */
function DotMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="pointer-events-none absolute inset-0 opacity-0 peer-checked:opacity-100"
      fill="currentColor"
    >
      <circle cx="8" cy="8" r="3.25" />
    </svg>
  );
}

/**
 * One drawn control with its word beside it.
 *
 * @param {object} props
 * @param {'checkbox'|'radio'} props.type
 * @param {string} props.label
 * @param {string} [props.description] a second line under the word
 * @param {string} [props.error] the message under the control
 */
function Choice({ type, label, description, error, className = '', ...rest }) {
  const id = useId();
  const errorId = `${id}-error`;
  const Mark = type === 'radio' ? DotMark : CheckMark;
  return (
    <div className="flex flex-col gap-3xs">
      <label
        htmlFor={id}
        className={`touch-target flex items-start gap-sm py-2xs font-body text-body text-text-primary ${className}`}
      >
        <span className="relative mt-3xs inline-flex text-surface">
          <input
            id={id}
            type={type}
            className={`peer control-choice ${type === 'radio' ? 'control-choice--radio' : ''}`}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            {...rest}
          />
          <Mark />
        </span>
        <span className="flex flex-col gap-3xs">
          <span>{label}</span>
          {description ? (
            <span className="font-data text-caption text-text-secondary">{description}</span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p id={errorId} className="font-data text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Pick any. */
export function Checkbox(props) {
  return <Choice {...props} type="checkbox" />;
}

/** Pick one. Give every control in a group the same `name`. */
export function Radio(props) {
  return <Choice {...props} type="radio" />;
}
