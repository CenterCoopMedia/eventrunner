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
import { useEffect, useId, useRef, useState } from 'react';
import AdminIconControl from './AdminIconControl.jsx';
import './adminControls.css';

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
  'min-h-admin-control min-w-0 w-full rounded-admin border-admin-hairline border-admin-rule-control ' +
  'bg-admin-ground-input px-sm py-xs font-admin-ui text-admin-base text-admin-ink ' +
  'placeholder:text-admin-ink-data hover:border-admin-action ' +
  'aria-[invalid=true]:border-admin-rule-alarm';

// Buttons are all one height — the control height — and one type size. The
// hierarchy is in the fill: one filled action per surface, quiet secondary
// controls beside it. An oversized primary action is the pattern §2.4
// rejects, and the room never shouts (admin story part 5).
const buttonBase =
  'admin-button inline-flex min-h-admin-control items-center justify-center gap-2xs rounded-admin ' +
  'border-admin-hairline px-md py-xs font-admin-ui text-admin-base leading-tight ' +
  'disabled:cursor-not-allowed';

/**
 * The filled control: the admin's action colour. By default that is the
 * brand colour worked into a family that holds its bars in both modes
 * (shared/theme deriveAdminScheme), or the house scheme the Branding tab
 * picked. Never the raw client accent.
 */
export const primaryButtonClass =
  `${buttonBase} admin-button--primary border-admin-action bg-admin-action font-bold text-admin-ink-inverse ` +
  'hover:border-admin-action-hover hover:bg-admin-action-hover active:bg-admin-action-pressed';

/** The quiet control: white, ruled, and lifted to the soft action ground under the pointer. */
export const secondaryButtonClass =
  `${buttonBase} admin-button--secondary border-admin-rule-control bg-admin-ground-raised font-medium text-admin-ink ` +
  'hover:border-admin-action-soft-hover hover:bg-admin-action-soft hover:text-admin-ink-link';

/** A selected choice. It is pressed, not a commit, so it does not use the publish fill. */
export const choiceButtonClass =
  `${buttonBase} admin-button--choice border-admin-action bg-admin-action-soft font-bold text-admin-ink ` +
  'hover:border-admin-action-hover hover:bg-admin-action-soft';

/**
 * Unavailable, for a control that must stay focusable to say why it does
 * nothing (`aria-disabled="true"`, its handler refusing every press): the
 * disabled ink on the alternate ground, with the hover tint held off. Add it
 * beside the control's own class. It is not in buttonBase because a busy
 * control carries aria-disabled too and keeps its own look.
 */
export const unavailableButtonClass =
  'aria-disabled:border-admin-rule-strong aria-disabled:bg-admin-ground-soft ' +
  'aria-disabled:text-admin-ink-disabled aria-disabled:hover:border-admin-rule-strong ' +
  'aria-disabled:hover:bg-admin-ground-soft aria-disabled:hover:text-admin-ink-disabled';

/** The quietest control: no rule until the pointer arrives. */
export const ghostButtonClass =
  `${buttonBase} admin-button--quiet border-transparent bg-transparent font-medium text-admin-ink-secondary ` +
  'hover:bg-admin-ground-soft hover:text-admin-ink';

/**
 * A destructive control: the alarm ink on the alarm ground, at NORMAL size,
 * with nothing animated; it fills only under the pointer. The label is the
 * caller's, and it repeats the consequence — "Delete this page", never
 * "Confirm" (admin story moment 3).
 */
export const dangerButtonClass =
  `${buttonBase} admin-button--danger border-admin-rule-alarm bg-admin-ground-alarm font-semibold text-admin-state-error ` +
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

/** Reserve both labels' width while exposing only the current action name. */
export function ActionLabel({ busy, pending, children }) {
  return (
    <span className="inline-grid">
      <span className={`[grid-area:1/1] ${busy ? 'invisible' : ''}`} aria-hidden={busy || undefined}>{children}</span>
      <span className={`[grid-area:1/1] ${busy ? '' : 'invisible'}`} aria-hidden={!busy || undefined}>{pending}</span>
    </span>
  );
}

/** A labelled text-ish input. `error` is the server's message, verbatim. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  warning,
  type = 'text',
  className = '',
  ...rest
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const warningId = `${id}-warning`;
  const describedBy = [hint ? hintId : null, warning ? warningId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="admin-field flex min-w-0 flex-col gap-3xs">
      <label htmlFor={id} className={`${fieldLabelClass} admin-field__label`}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={`${fieldHintClass} admin-field__hint`}>
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        type={type}
        className={`${inputClass} admin-field__control ${className}`}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {/* A warning does not block the save. It states a consequence of the
          value in words, under the field, and the field names it. It can
          appear while the operator types, so it lands in a polite live
          region that is on the page before it: a region added together with
          its text is not announced. A caller that may warn passes a string,
          empty while there is nothing to say; undefined draws no region. */}
      {warning !== undefined || error ? (
        <div className="admin-field__feedback">
          {warning !== undefined ? (
            <div aria-live="polite">
              {warning ? (
                <p id={warningId} className="text-admin-sm font-medium text-admin-state-caution">
                  {warning}
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? <FieldError id={errorId} message={error} /> : null}
        </div>
      ) : null}
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
    <div className="admin-field flex min-w-0 flex-col gap-3xs">
      <label htmlFor={id} className={`${fieldLabelClass} admin-field__label`}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={`${fieldHintClass} admin-field__hint`}>
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        rows={rows}
        className={`${inputClass} admin-field__control ${className}`}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {error ? <div className="admin-field__feedback"><FieldError id={errorId} message={error} /></div> : null}
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
    <div className="admin-field flex min-w-0 flex-col gap-3xs">
      <label htmlFor={id} className={`${fieldLabelClass} admin-field__label`}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={`${fieldHintClass} admin-field__hint`}>
          {hint}
        </p>
      ) : null}
      <select
        id={id}
        className={`${inputClass} admin-field__control ${className}`}
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
      {error ? <div className="admin-field__feedback"><FieldError id={errorId} message={error} /></div> : null}
    </div>
  );
}

/**
 * A list built one item at a time: type, then press Enter or the plus button.
 * Text left in the box joins the list when the box loses focus, so a save
 * never drops it. Pasted lines become one item each. An exact repeat is
 * ignored; the caller's own check names anything else it refuses.
 *
 * @param {{ label: string, items: string[], onChange: (items: string[]) => void,
 *           itemName: string, hint?: string, error?: string }} props
 *   Other props go to the input, for example `inputMode`.
 */
export function AddOneListField({ label, items, onChange, itemName, hint, error, ...rest }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [draft, setDraft] = useState('');
  const [heldRows, setHeldRows] = useState(null);
  const mouseIsDown = useRef(false);
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  // A click on Save blurs this input first. A new row drawn at that moment
  // would move Save away from the pointer and lose the click, so the row
  // waits for the release. The list value itself updates at once.
  useEffect(() => {
    const press = () => { mouseIsDown.current = true; };
    const release = () => {
      mouseIsDown.current = false;
      setTimeout(() => setHeldRows(null), 0);
    };
    document.addEventListener('mousedown', press, true);
    document.addEventListener('mouseup', release, true);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('mousedown', press, true);
      document.removeEventListener('mouseup', release, true);
    };
  }, []);

  const visibleItems = items.slice(0, heldRows ?? items.length);

  const add = (text) => {
    const added = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const next = [...items];
    for (const item of added) if (!next.includes(item)) next.push(item);
    if (next.length !== items.length) onChange(next);
    setDraft('');
  };

  return (
    <div className="flex min-w-0 flex-col gap-3xs">
      <label htmlFor={id} className={fieldLabelClass}>{label}</label>
      {hint ? <p id={hintId} className={fieldHintClass}>{hint}</p> : null}
      <div className="flex items-center gap-2xs">
        <input
          id={id}
          type="text"
          className={`${inputClass} min-w-0 flex-1`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            add(draft);
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData?.getData('text') ?? '';
            if (!pasted.includes('\n')) return;
            event.preventDefault();
            const { selectionStart, selectionEnd } = event.target;
            const start = selectionStart ?? draft.length;
            add(`${draft.slice(0, start)}${pasted}${draft.slice(selectionEnd ?? start)}`);
          }}
          onBlur={() => {
            if (mouseIsDown.current) setHeldRows(items.length);
            add(draft);
          }}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          {...rest}
        />
        <button type="button" className={secondaryButtonClass} onClick={() => add(draft)} aria-label={`Add ${itemName}`}>+</button>
      </div>
      {visibleItems.length ? (
        <ul className="flex flex-col gap-3xs" aria-label={`${label} list`}>
          {visibleItems.map((item) => (
            <li key={item} className="flex items-center justify-between gap-xs text-admin-base text-admin-ink">
              <span className="min-w-0 break-words">{item}</span>
              <button type="button" className={ghostButtonClass} onClick={() => onChange(items.filter((other) => other !== item))} aria-label={`Remove ${item}`}>×</button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <FieldError id={errorId} message={error} /> : null}
    </div>
  );
}

/** A labelled checkbox. */
export function CheckboxField({ label, checked, onChange, hint, ...rest }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="admin-field-toggle">
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
export function ServerErrorSummary({ error, errorRef, title = 'This was not saved' }) {
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
        <ul className="mt-2xs list-disc ps-5 text-admin-sm">
          {segments.map((segment, index) => (
            <li key={`${segment.message}-${index}`}>{segment.message}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3xs text-admin-sm">{segments.length === 1 ? segments[0].message : error.message}</p>
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
 * @param {string} [props.triggerIcon] show an icon control with the trigger as its accessible name
 * @param {string} props.confirmLabel the verb-first label that does the work
 * @param {string} props.consequence what is lost, in one plain sentence
 * @param {string} [props.permanence] said the same way every time it applies
 * @param {() => void} props.onConfirm
 * @param {boolean} [props.disabled]
 * @param {string} [props.busyLabel] shown while the call is in flight
 * @param {boolean} [props.busy]
 * @param {string} [props.title] heading for the moment
 * @param {boolean} [props.initiallyOpen] open the warning when the trigger was already confirmed elsewhere
 */
export function DestructiveConfirm({
  trigger,
  triggerIcon,
  confirmLabel,
  consequence,
  permanence,
  onConfirm,
  disabled = false,
  busy = false,
  busyLabel,
  title,
  className = '',
  initiallyOpen = false,
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const headingId = useId();
  const consequenceId = useId();
  const headingRef = useRef(null);
  const triggerRef = useRef(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) headingRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!open) {
    if (triggerIcon) return (
      <AdminIconControl
        ref={triggerRef}
        label={trigger}
        icon={triggerIcon}
        className={`${dangerButtonClass} ${className}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
    );
    return (
      <button
        ref={triggerRef}
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
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (!busy) setOpen(false);
      }}
      className={`flex flex-col gap-xs rounded-admin-panel border-admin-alarm border-admin-rule-alarm bg-admin-ground-alarm px-md py-sm ${className}`}
    >
      <h2 ref={headingRef} id={headingId} tabIndex={-1} aria-describedby={consequenceId} className="text-admin-base font-bold text-admin-state-error">
        {title ?? trigger}
      </h2>
      <p id={consequenceId} className="text-admin-sm text-admin-ink">
        {consequence}
        {permanence ? <> {permanence}</> : null}
      </p>
      <div className="flex flex-wrap items-center gap-xs">
        <button
          type="button"
          className={dangerButtonClass}
          disabled={busy || disabled}
          aria-busy={busy || undefined}
          onClick={() => { if (!busy && !disabled) onConfirm(); }}
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
      className={`admin-panel min-w-0 rounded-admin-panel border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised ${
        flush ? '' : 'p-md'
      } ${className}`}
    >
      {title ? (
        <div
          className={`${
            flush ? 'px-md pt-md ' : ''
          }admin-panel__heading mb-sm flex flex-wrap items-start justify-between gap-sm border-admin-rule-hairline border-b-admin-hairline pb-sm`}
        >
          <div className="min-w-0 flex-auto">
            <h2 className="font-admin-ui text-admin-lg font-bold text-admin-ink">{title}</h2>
            {description ? (
              <p className="mt-3xs text-admin-sm text-admin-ink-secondary">
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
