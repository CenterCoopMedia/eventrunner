// The copy bench — form primitives for the desk (no form library; the forms
// here are plain controlled inputs, and a dependency would buy nothing but
// bundle weight).
//
// Every control reads the `admin-*` tokens and nothing else: the admin has
// one fixed identity, so a client's preset never reaches a field, a button,
// or a rule in this room (design brief §5.2, admin story part 2, desk
// amendment docs/plans/2026-09-10-admin-editorial-desk.md). The public
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

// The field boundary is --admin-rule-control, not the hairline: a form
// control's boundary is non-text user interface under WCAG 1.4.11 and needs
// 3:1 against its own ground, which the hairline (tuned for row separators)
// does not clear.
/**
 * The label above a field, and the hint under the label. One source each:
 * these strings appear on every control in this file and on the hand-built
 * fields elsewhere in the room, and a copy that drifts is a control that
 * stops matching its neighbours.
 */
export const fieldLabelClass = 'text-admin-base font-semibold text-admin-ink';
export const fieldHintClass = 'text-admin-sm text-admin-ink-secondary';

// Neither a field nor a button carries `admin-target`: that class is the
// 24px floor under a quiet in-row link, and Tailwind emits it after the
// generated utilities, so on the same element it would beat the control
// height at equal specificity and the control would fall to its padding.
export const inputClass =
  'min-h-admin-control w-full rounded-admin border-admin-hairline border-admin-rule-control ' +
  'bg-admin-ground-input px-sm py-xs font-admin-ui text-admin-base text-admin-ink ' +
  'placeholder:text-admin-ink-data hover:border-admin-action ' +
  'aria-[invalid=true]:border-admin-rule-alarm';

// Buttons are all one height — the control height — and one type size. The
// hierarchy is in the fill: one filled action per surface, quiet secondary
// controls beside it. An oversized primary action is the pattern §2.4
// rejects, and the room never shouts (admin story part 5).
const buttonBase =
  'inline-flex min-h-admin-control items-center justify-center gap-2xs rounded-admin ' +
  'border-admin-hairline px-md py-xs font-admin-ui text-admin-base leading-tight ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The filled control: the admin's action colour. By default that is the
 * brand colour worked into a family that holds its bars in both modes
 * (shared/theme deriveAdminScheme), or the house scheme the Branding tab
 * picked. Never the raw client accent.
 */
export const primaryButtonClass =
  `${buttonBase} border-admin-action bg-admin-action font-bold text-admin-ink-inverse ` +
  'hover:border-admin-action-hover hover:bg-admin-action-hover active:bg-admin-action-pressed';

/** The quiet control: white, ruled, and lifted to the soft action ground under the pointer. */
export const secondaryButtonClass =
  `${buttonBase} border-admin-rule-strong bg-admin-ground-raised font-medium text-admin-ink ` +
  'hover:border-admin-action-soft-hover hover:bg-admin-action-soft hover:text-admin-ink-link';

/** The quietest control: no rule until the pointer arrives. */
export const ghostButtonClass =
  `${buttonBase} border-transparent bg-transparent font-medium text-admin-ink-secondary ` +
  'hover:bg-admin-ground-soft hover:text-admin-ink';

/**
 * A destructive control: the alarm ink on the alarm ground, at NORMAL size,
 * with nothing animated; it fills only under the pointer. The label is the
 * caller's, and it repeats the consequence — "Delete this page", never
 * "Confirm" (admin story moment 3).
 */
export const dangerButtonClass =
  `${buttonBase} border-transparent bg-admin-ground-alarm font-semibold text-admin-state-error ` +
  'hover:border-admin-rule-alarm hover:bg-admin-state-error hover:text-admin-ink-inverse';

/** A quiet in-row control: a link-coloured word, still a button, still a 24px target. */
export const linkButtonClass =
  'admin-target inline-flex items-center rounded-admin-small px-2xs py-3xs font-admin-ui text-admin-sm ' +
  'font-semibold text-admin-ink-link underline-offset-2 hover:underline disabled:opacity-60';

/** The title of a record in a list row: a link in the ink, underlined only under the pointer. */
export const rowTitleLinkClass =
  'admin-target inline-flex items-center rounded-admin-small text-admin-base font-bold text-admin-ink ' +
  'underline-offset-4 hover:text-admin-ink-link hover:underline';

/** The identifiers under a row's title: paths, ids, counts, in the data face. */
export const rowMetaClass = 'font-admin-data text-admin-xs text-admin-ink-data';

/** One list row's inner padding, so every galley in the room keeps one rhythm. */
export const rowClass = 'flex flex-wrap items-center justify-between gap-sm px-md py-sm';

/** A labelled text-ish input. `error` is the server's message, verbatim. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  className = '',
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
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        type={type}
        className={`${inputClass} ${className}`}
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
export function TextAreaField({
  label,
  value,
  onChange,
  error,
  hint,
  rows = 3,
  className = '',
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
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        rows={rows}
        className={`${inputClass} ${className}`}
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
export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  hint,
  className = '',
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
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}
      <select
        id={id}
        className={`${inputClass} ${className}`}
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
        className="mt-3xs h-5 w-5 shrink-0 rounded-admin-small border-admin-rule-control bg-admin-ground-input accent-admin-action"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      <div className="flex flex-col">
        <label htmlFor={id} className={fieldLabelClass}>
          {label}
        </label>
        {hint ? (
          <p id={hintId} className={fieldHintClass}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A field's own query: a mark, a word, and the reason under the field.
 *
 * Exported, because the room has fields this file does not build — a group
 * of checkboxes with one shared error, a list with no single input of its
 * own — and a second spelling of this markup is a second answer to "what
 * does a rejected field look like". Renders nothing without a message, so a
 * caller can pass one through unconditionally.
 *
 * `role` is normally left off: a form with several fields that fires several
 * alerts at once is noise, which is why a rejected save is announced once,
 * by ServerErrorSummary. A surface with ONE thing that can be rejected — the
 * upload modal's file — has no summary to carry the announcement, so it asks
 * for role="alert" here. The markup and the appearance stay the same either
 * way, which is the whole point of this component.
 */
export function FieldError({ id, message, role }) {
  if (!message) return null;
  return (
    <p id={id} role={role} className="text-admin-sm font-medium text-admin-state-error">
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
      <p className="text-admin-base font-bold">{title}</p>
      {segments.length > 1 ? (
        <ul className="mt-2xs list-disc ps-5 font-admin-data text-admin-sm">
          {segments.map((segment, index) => (
            <li key={`${segment.message}-${index}`}>{segment.message}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3xs font-admin-data text-admin-sm">{error.message}</p>
      )}
    </div>
  );
}

/** A saved/idle status line, stated in place. Routine work uses role=status. */
export function SaveStatus({ message }) {
  return (
    <p role="status" className="text-admin-sm text-admin-ink-secondary">
      {message}
    </p>
  );
}

/** Notice ink and ground per tone. Each tone always carries its own words. */
const NOTICE_TONES = Object.freeze({
  info: 'border-admin-rule-hairline bg-admin-ground-info text-admin-state-info',
  ok: 'border-admin-rule-hairline bg-admin-ground-ok text-admin-state-ok',
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
      className={`rounded-admin border-admin-hairline px-md py-sm text-admin-sm font-medium ${
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
      className={`flex flex-col gap-xs rounded-admin-panel border-admin-alarm border-admin-rule-alarm bg-admin-ground-alarm px-md py-sm ${className}`}
    >
      <h2 id={headingId} className="text-admin-base font-bold text-admin-state-error">
        {title ?? trigger}
      </h2>
      <p className="max-w-[65ch] text-admin-sm text-admin-ink">
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
 * A panel on the stone: the white work surface on the canvas, inside a
 * hairline rule with the panel radius, and never a shadow — elevation in
 * this room is the step from the canvas to the paper (desk amendment,
 * part a).
 *
 * `flush` drops the panel's own padding so a galley's hairline rows run the
 * full measure to the panel rule and supply their own gutters. It is a prop
 * rather than a `p-0` in `className` because Tailwind emits the named
 * spacing steps AFTER the numeric ones — `p-md` would win the cascade and
 * the override would silently do nothing.
 */
export function Panel({
  title,
  description,
  children,
  actions,
  className = '',
  flush = false,
}) {
  return (
    <section
      className={`rounded-admin-panel border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised ${
        flush ? '' : 'p-md'
      } ${className}`}
    >
      {title ? (
        <div
          className={`${
            flush ? 'px-md pt-md ' : ''
          }mb-sm flex flex-wrap items-start justify-between gap-sm border-admin-rule-hairline border-b-admin-hairline pb-sm`}
        >
          <div className="min-w-0">
            <h2 className="font-admin-ui text-admin-lg font-bold text-admin-ink">{title}</h2>
            {description ? (
              <p className="mt-3xs max-w-[65ch] text-admin-sm text-admin-ink-secondary">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-xs">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
