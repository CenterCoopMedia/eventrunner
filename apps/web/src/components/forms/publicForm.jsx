// Form controls for the PUBLIC site (design brief §3.1, §5.1).
//
// The public site and the admin are two tiers, and their controls are now
// two modules. The public forms used to import the admin's primitives, which
// meant a visitor's feedback form was set in whatever face and ground the
// admin identity happened to hold — the tier mismatch PR1 flagged. These
// controls read the tier-2 semantic tokens the rest of the public surface
// reads, so a client's preset restyles them like everything else, and the
// admin identity stays where it belongs.
//
// The shape is the same on both sides, because accessibility is not a tier:
// a real <label> tied by id and sitting above its own input (a control label
// is the one thing the eyebrow ban explicitly does not touch, brief §2.4),
// its hint under the label, the field inside a boundary that clears 3:1, and
// the error under the field as text — never colour alone.
//
// The class strings themselves are not here. Every shared control shape on
// the public site — the input, the filled action, the outlined action, the
// quiet one — has exactly one copy, in components/controlClasses.js. These
// fields read the input shape from there, so a field a builder composes by
// hand and a field built here draw the same control.
import { useId } from 'react';
import { inputClass } from '../controlClasses.js';

function describedBy(hint, hintId, error, errorId) {
  return [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
}

/** A labelled text-ish input. */
export function TextField({ label, value, onChange, error, hint, type = 'text', ...rest }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-2xs">
      <label htmlFor={id} className="font-data text-caption font-semibold text-text-primary">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-caption text-text-secondary">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        type={type}
        className={inputClass}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(hint, hintId, error, errorId)}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          <span aria-hidden="true" className="font-semibold">
            !{' '}
          </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled multi-line input. */
export function TextAreaField({ label, value, onChange, error, hint, rows = 3, ...rest }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-2xs">
      <label htmlFor={id} className="font-data text-caption font-semibold text-text-primary">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-caption text-text-secondary">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        rows={rows}
        className={inputClass}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(hint, hintId, error, errorId)}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled <select> over `options: [{ value, label }]`. */
export function SelectField({ label, value, onChange, options, error, hint, ...rest }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-2xs">
      <label htmlFor={id} className="font-data text-caption font-semibold text-text-primary">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-caption text-text-secondary">
          {hint}
        </p>
      ) : null}
      <select
        id={id}
        className={inputClass}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(hint, hintId, error, errorId)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
