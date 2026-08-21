// Hand-rolled form primitives for the admin area (no form library — the
// forms here are plain controlled inputs, and a dependency would buy nothing
// but bundle weight).
//
// Every control follows the interface guidelines the public app already
// applies: a real <label> tied by id, 44px touch targets, aria-invalid plus
// an aria-describedby error message on failure, and errors that read as text
// rather than color alone.
import { useId } from 'react';

export const inputClass =
  'touch-target w-full rounded-brand border border-brand-ink/20 bg-brand-surface px-3 py-2 ' +
  'text-brand-ink placeholder:text-brand-ink-muted aria-[invalid=true]:border-danger';

export const primaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand bg-brand-primary ' +
  'px-4 py-2 font-semibold text-brand-surface hover:bg-brand-primary-dark disabled:opacity-60';

export const secondaryButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand border ' +
  'border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold text-brand-ink ' +
  'hover:bg-brand-surface-alt disabled:opacity-60';

export const dangerButtonClass =
  'touch-target inline-flex items-center justify-center rounded-brand border ' +
  'border-danger/40 bg-danger/10 px-4 py-2 font-semibold text-danger ' +
  'hover:bg-danger/20 disabled:opacity-60';

/** A labelled text-ish input. `error` is the server's message, verbatim. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  ...rest
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-brand-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-brand-ink-muted">
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
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          <span aria-hidden="true" className="font-semibold">
            !{' '}
          </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled multi-line input (rich-text and long descriptions). */
export function TextAreaField({ label, value, onChange, error, hint, rows = 3, ...rest }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-brand-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-brand-ink-muted">
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
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-sm text-danger">
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
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-brand-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-brand-ink-muted">
          {hint}
        </p>
      ) : null}
      <select
        id={id}
        className={inputClass}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled checkbox. */
export function CheckboxField({ label, checked, onChange, hint, ...rest }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-5 w-5 rounded-brand border-brand-ink/30"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="text-sm font-semibold text-brand-ink">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-sm text-brand-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The server's rejection, shown verbatim: the whole message plus each
 * `field: reason` segment it joined. role="alert" because a failed save is
 * the urgent case the guidelines reserve it for; tabIndex -1 so a submit
 * handler can move focus here.
 */
export function ServerErrorSummary({ error, errorRef, title = 'The server rejected this save' }) {
  if (!error) return null;
  const segments = error.fieldErrors ?? [];
  return (
    <div
      role="alert"
      ref={errorRef}
      tabIndex={-1}
      className="rounded-brand border border-danger/40 bg-danger/10 px-4 py-3 text-danger"
    >
      <p className="font-semibold">{title}</p>
      {segments.length > 1 ? (
        <ul className="mt-2 list-disc ps-5 text-sm">
          {segments.map((segment, index) => (
            <li key={`${segment.message}-${index}`}>{segment.message}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm">{error.message}</p>
      )}
    </div>
  );
}

/** A saved/idle status line. Routine confirmations use role="status". */
export function SaveStatus({ message }) {
  return (
    <p role="status" className="text-sm text-brand-ink-muted">
      {message}
    </p>
  );
}

/** Card wrapper shared by every admin panel. */
export function Panel({ title, description, children, actions }) {
  return (
    <section className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface p-4 sm:p-6">
      {title ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-semibold text-brand-ink">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-brand-ink-muted">{description}</p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
