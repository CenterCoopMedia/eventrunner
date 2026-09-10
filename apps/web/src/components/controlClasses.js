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
//
// THE STATE GRAMMAR (expansion record §2.1). Every control below carries the
// same eight states, so a reader learns them once:
//
//   Rest       the style's own ink and ground.
//   Hover      a tint of the control's own ground, at --state-hover-share,
//              behind `@media (hover: hover)`. It lands at once: a colour
//              change never transitions.
//   Focus      the 3px accent ring, drawn by the one :focus-visible rule in
//              index.css. A control never draws its own and never removes it.
//   Press      scale 0.98 on transform alone, at --motion-slow, inside
//              `motion-safe:` — plus the firmer tint, which is what carries
//              the press for a reader who asked for less motion.
//   Selected   the bold weight, plus a second signal: the selected tint on
//              `aria-pressed`, the filled ground on `aria-checked`, the
//              strong rule on `aria-selected`. Never colour alone.
//   Disabled   `aria-disabled="true"`, the disabled ink on the alternate
//              ground, the control still in the tab order and the pointer
//              unchanged. A removed control announces nothing.
//   Busy       `aria-busy="true"` and a stated word inside the control
//              ("Saving…"). The control stays enabled, the pointer is
//              unchanged, and nothing spins.
//   Error      the field states it, not the button: see components/forms.
//
// The `disabled:` half of each pair is kept beside the `aria-disabled:` half
// for the call sites that still use the attribute. Prefer `aria-disabled`.

/** Press: the one motion a control makes. Transform only, inside motion-safe. */
const pressClass =
  'active:scale-[0.98] motion-safe:transition-transform motion-safe:duration-slow ' +
  'motion-safe:ease-motion';

/** Unavailable: the disabled ink on the alternate ground, still focusable. */
const unavailableClass =
  'aria-disabled:bg-surface-alt aria-disabled:text-text-secondary ' +
  'disabled:bg-surface-alt disabled:text-text-secondary';

/**
 * Selected: the weight, so the state is never colour alone. `aria-pressed`
 * also takes the tint (it has no ground of its own); `aria-checked` and
 * `aria-selected` take the segmented control's filled ground and the tab's
 * strong rule instead.
 */
const selectedClass = 'aria-pressed:font-bold aria-checked:font-bold aria-selected:font-bold';

/** Every state a control shares. Compose it into each shape below. */
export const controlStateClass =
  `control-tint ${pressClass} ${unavailableClass} ${selectedClass}`;

// A form control's boundary is --color-border-control, not --rule-hairline
// (design brief §8.1 polish, WCAG 1.4.11): a rule is tuned for low-contrast
// section dividers, and a control's boundary needs 3:1 against its ground.
export const inputClass =
  'touch-target w-full rounded-brand border-hairline border-control bg-surface px-sm py-xs ' +
  'font-body text-body text-text-primary placeholder:text-text-secondary ' +
  'aria-[invalid=true]:border-danger';

/** The filled primary action. Sized by its own content. */
export const primaryActionClass =
  `${controlStateClass} touch-target inline-flex items-center justify-center rounded-brand ` +
  'bg-accent px-md py-xs font-data text-caption font-semibold text-surface';

/** The outlined action that sits beside a primary one. */
export const secondaryActionClass =
  `${controlStateClass} touch-target inline-flex items-center justify-center rounded-brand ` +
  'border-hairline border-rule-hairline bg-surface px-md py-xs font-data text-caption ' +
  'font-semibold text-text-primary';

/**
 * A page-level action in the editorial register: a ruled rectangle with no
 * fill, for a control that offers something rather than completing a task.
 */
export const quietActionClass =
  `${controlStateClass} touch-target inline-flex items-center rounded-brand border-hairline ` +
  'border-rule-hairline px-md py-2xs font-data text-caption font-medium text-text-primary';

/** The same two actions across a form's full width, for a submit row. */
export const primaryButtonClass = `${primaryActionClass} w-full`;
export const secondaryButtonClass = `${secondaryActionClass} w-full`;
