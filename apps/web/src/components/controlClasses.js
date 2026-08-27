// The class strings for the shared controls: one source for each shape.
//
// Every one of these was copied into page after page, and the copies had
// already drifted — the filled action hovered on eight call sites and stayed
// inert on fourteen. A class string that describes a shape the whole site
// uses belongs in one place, so the site cannot drift apart again.
//
// These are strings, not components, because a control is an <a>, a
// <button>, or a <Link> depending on what it does, and the element is the
// caller's decision. Compose with a template literal where a call site needs
// one more utility; both halves stay literal in the source, so Tailwind's
// scanner still sees every class.
//
// Colors read the tier 2 role names and spacing reads the named steps
// (design brief §3.1, §3.7). Shapes are rectangles on the theme radius,
// never pills (§2.4).

// A form control's boundary is --color-border-control, not --rule-hairline
// (design brief §8.1 polish, WCAG 1.4.11): a rule is tuned for low-contrast
// section dividers, and a control's boundary needs 3:1 against its ground.
export const inputClass =
  'touch-target w-full rounded-brand border-hairline border-control bg-surface px-sm py-xs ' +
  'font-body text-body text-text-primary placeholder:text-text-secondary ' +
  'aria-[invalid=true]:border-danger';

/** The filled primary action. Sized by its own content. */
export const primaryActionClass =
  'touch-target inline-flex items-center justify-center rounded-brand bg-accent ' +
  'px-md py-xs font-data text-caption font-semibold text-surface ' +
  'hover:bg-accent-strong disabled:opacity-60';

/** The outlined action that sits beside a primary one. */
export const secondaryActionClass =
  'touch-target inline-flex items-center justify-center rounded-brand ' +
  'border-hairline border-rule-hairline bg-surface px-md py-xs font-data text-caption ' +
  'font-semibold text-text-primary hover:bg-surface-alt disabled:opacity-60';

/**
 * A page-level action in the editorial register: a ruled rectangle with no
 * fill, for a control that offers something rather than completing a task.
 */
export const quietActionClass =
  'touch-target inline-flex items-center rounded-brand border-hairline border-rule-hairline ' +
  'px-md py-2xs font-data text-caption font-medium text-text-primary hover:bg-surface-alt';

/** The same two actions across a form's full width, for a submit row. */
export const primaryButtonClass = `${primaryActionClass} w-full`;
export const secondaryButtonClass = `${secondaryActionClass} w-full`;
