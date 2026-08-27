// The copy bench — form primitives for the composing room (no form library;
// the forms here are plain controlled inputs, and a dependency would buy
// nothing but bundle weight).
//
// Every control reads the `admin-*` tokens and nothing else: the admin has
// one fixed identity, so a client's preset never reaches a field, a button,
// or a rule in this room (design brief §5.2, admin story part 2). The public
// site's own controls live in components/forms/publicForm.jsx and run on the
// tier-2 tokens — the two tiers stay apart on purpose.
//
// The pattern, unchanged from the accessibility work that built it: a real
// <label> tied by id and sitting ABOVE its own input (a control label is the
// one thing the eyebrow ban explicitly does not touch — never "fix" it),
// its hint under the label, the field on the input ground inside a rule
// that clears 3:1, and the error under the field with a mark and a word.
// `aria-invalid` plus `aria-describedby` carry the failure to a screen
// reader; nothing is signalled by colour alone.
import { useId, useState } from 'react';

// The field boundary is --admin-rule-strong, not the hairline: a form
// control's boundary is non-text user interface under WCAG 1.4.11 and needs
// 3:1 against its own ground, which the hairline (tuned for row separators)
// does not clear.
export const inputClass =
  'admin-target w-full rounded-admin border-admin-hairline border-admin-rule-strong ' +
  'bg-admin-ground-input px-sm py-2xs font-admin-ui text-caption text-admin-ink ' +
  'placeholder:text-admin-ink-secondary aria-[invalid=true]:border-admin-rule-alarm';

// Buttons are all one size. An oversized primary action is the pattern
// §2.4 rejects, and the room never shouts (admin story part 5).
const buttonBase =
  'admin-target inline-flex items-center justify-center rounded-admin px-sm py-2xs ' +
  'font-admin-ui text-caption font-semibold disabled:opacity-60';

/** The filled control: type metal. Never the client accent. */
export const primaryButtonClass =
  `${buttonBase} bg-admin-ink text-admin-ink-inverse hover:bg-admin-ink/90`;

export const secondaryButtonClass =
  `${buttonBase} border-admin-hairline border-admin-rule-strong bg-admin-ground-raised ` +
  'text-admin-ink hover:bg-admin-ground-input';

/**
 * A destructive control: the alarm ground inside the alarm rule, at NORMAL
 * size, with nothing animated. The label is the caller's, and it repeats the
 * consequence — "Delete this page", never "Confirm" (admin story moment 3).
 */
export const dangerButtonClass =
  `${buttonBase} border-admin-hairline border-admin-rule-alarm bg-admin-ground-alarm ` +
  'text-admin-state-error hover:bg-admin-ground-alarm/70';

/** A quiet in-row control: still a button, still a 24px target. */
export const linkButtonClass =
  'admin-target inline-flex items-center rounded-admin px-2xs py-3xs font-admin-ui text-folio ' +
  'text-admin-ink-link underline underline-offset-2 hover:text-admin-ink disabled:opacity-60';

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
    <div className="flex flex-col gap-3xs">
      <label htmlFor={id} className="text-caption font-semibold text-admin-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-folio text-admin-ink-secondary">
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
      {error ? <FieldError id={errorId} message={error} /> : null}
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
    <div className="flex flex-col gap-3xs">
      <label htmlFor={id} className="text-caption font-semibold text-admin-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-folio text-admin-ink-secondary">
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
      {error ? <FieldError id={errorId} message={error} /> : null}
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
    <div className="flex flex-col gap-3xs">
      <label htmlFor={id} className="text-caption font-semibold text-admin-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-folio text-admin-ink-secondary">
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
      {error ? <FieldError id={errorId} message={error} /> : null}
    </div>
  );
}

/** A labelled checkbox. */
export function CheckboxField({ label, checked, onChange, hint, ...rest }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex items-start gap-xs">
      <input
        id={id}
        type="checkbox"
        className="mt-3xs h-5 w-5 rounded-admin border-admin-rule-strong bg-admin-ground-input"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="text-caption font-semibold text-admin-ink">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-folio text-admin-ink-secondary">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A field's own query: a mark, a word, and the reason under the field. */
function FieldError({ id, message }) {
  return (
    <p id={id} className="text-folio text-admin-state-error">
      <span aria-hidden="true" className="font-semibold">
        !{' '}
      </span>
      {message}
    </p>
  );
}

/**
 * The query — the server's rejection, shown verbatim: the whole message plus
 * each `field: reason` segment it joined. It renders on the alarm ground
 * inside the alarm rule, `role="alert"` because a failed save is the urgent
 * case the guidelines reserve it for, and `tabIndex -1` so a submit handler
 * can move focus here. The failed value is never discarded.
 */
export function ServerErrorSummary({ error, errorRef, title = 'The server rejected this save' }) {
  if (!error) return null;
  const segments = error.fieldErrors ?? [];
  return (
    <div
      role="alert"
      ref={errorRef}
      tabIndex={-1}
      className="rounded-admin border-admin-alarm border-admin-rule-alarm bg-admin-ground-alarm px-md py-sm text-admin-state-error"
    >
      <p className="text-caption font-semibold">{title}</p>
      {segments.length > 1 ? (
        <ul className="mt-2xs list-disc ps-5 font-admin-data text-folio">
          {segments.map((segment, index) => (
            <li key={`${segment.message}-${index}`}>{segment.message}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3xs font-admin-data text-folio">{error.message}</p>
      )}
    </div>
  );
}

/** A saved/idle status line, stated in place. Routine work uses role=status. */
export function SaveStatus({ message }) {
  return (
    <p role="status" className="text-caption text-admin-ink-secondary">
      {message}
    </p>
  );
}

/** Notice ink and ground per tone. Each tone always carries its own words. */
const NOTICE_TONES = Object.freeze({
  info: 'border-admin-rule-hairline bg-admin-ground-raised text-admin-ink',
  ok: 'border-admin-rule-hairline bg-admin-ground-raised text-admin-state-ok',
  caution: 'border-admin-rule-hairline bg-admin-ground-proof text-admin-state-caution',
  error: 'border-admin-rule-alarm bg-admin-ground-alarm text-admin-state-error',
});

/**
 * A result stated in place, next to the control that caused it, and it
 * stays. A toast may repeat it; a toast may never be the only record of what
 * happened (admin story part 5).
 *
 * @param {{ tone?: 'info'|'ok'|'caution'|'error', message: React.ReactNode }} props
 */
export function Notice({ tone = 'info', message, children }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-admin border-admin-hairline px-sm py-2xs text-caption ${
        NOTICE_TONES[tone] ?? NOTICE_TONES.info
      }`}
    >
      {message}
      {children}
    </p>
  );
}

/**
 * A destructive moment (admin story moment 3).
 *
 * The trigger opens a still surface: the alarm ground inside the alarm rule,
 * a sentence naming what is removed, where it goes, and whether anything
 * survives, and a confirm button that repeats the consequence at normal
 * size. Nothing animates — no shake, no pulse, no countdown, no colour
 * transition. A still surface reads as serious; a moving one reads as a
 * game.
 *
 * @param {object} props
 * @param {string} props.trigger the verb-first label that opens the moment
 * @param {string} props.confirmLabel the verb-first label that does the work
 * @param {string} props.consequence what is lost, in one plain sentence
 * @param {string} [props.permanence] said the same way every time it applies
 * @param {() => void} props.onConfirm
 * @param {boolean} [props.disabled]
 * @param {string} [props.busyLabel] shown while the call is in flight
 * @param {boolean} [props.busy]
 * @param {string} [props.title] heading for the moment
 */
export function DestructiveConfirm({
  trigger,
  confirmLabel,
  consequence,
  permanence,
  onConfirm,
  disabled = false,
  busy = false,
  busyLabel,
  title,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();

  if (!open) {
    return (
      <button
        type="button"
        className={`${dangerButtonClass} ${className}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </button>
    );
  }
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-xs rounded-admin border-admin-alarm border-admin-rule-alarm bg-admin-ground-alarm px-md py-sm ${className}`}
    >
      <h2 id={headingId} className="text-caption font-semibold text-admin-state-error">
        {title ?? trigger}
      </h2>
      <p className="max-w-[65ch] text-caption text-admin-ink">
        {consequence}
        {permanence ? ` ${permanence}` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-xs">
        <button
          type="button"
          className={dangerButtonClass}
          disabled={busy}
          onClick={() => onConfirm()}
        >
          {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Keep it
        </button>
      </div>
    </section>
  );
}

/**
 * A ruled region of the stone. Regions are separated by rules and by tint,
 * never by a floating rounded card and never by a shadow: elevation in this
 * room is tint (admin story part 6).
 */
export function Panel({ title, description, children, actions, className = '' }) {
  return (
    <section
      className={`rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-md ${className}`}
    >
      {title ? (
        <div className="mb-sm flex flex-wrap items-start justify-between gap-sm border-admin-rule-hairline border-b-admin-hairline pb-2xs">
          <div>
            <h2 className="font-admin-ui text-lead font-semibold text-admin-ink">{title}</h2>
            {description ? (
              <p className="mt-3xs max-w-[65ch] text-caption text-admin-ink-secondary">
                {description}
              </p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
