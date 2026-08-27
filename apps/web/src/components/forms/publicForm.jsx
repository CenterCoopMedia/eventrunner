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
import { useId } from 'react';

// The boundary is --color-border-control, not --rule-hairline (design brief
// §8.1 polish, WCAG 1.4.11): a rule is tuned for low-contrast section
// dividers, and a form control's boundary needs 3:1 against its ground.
export const inputClass =
  'touch-target w-full rounded-brand border-hairline border-control bg-surface px-sm py-xs ' +
  'font-body text-body text-text-primary placeholder:text-text-secondary ' +
  'aria-[invalid=true]:border-danger';

export const primaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand bg-accent px-md py-xs ' +
  'font-data text-caption font-semibold text-surface hover:bg-accent-strong disabled:opacity-60';

export const secondaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand border-hairline ' +
  'border-rule-hairline bg-surface px-md py-xs font-data text-caption font-semibold ' +
  'text-text-primary hover:bg-surface-alt disabled:opacity-60';

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
