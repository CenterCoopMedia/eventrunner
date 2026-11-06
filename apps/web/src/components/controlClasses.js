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
//   Hover      the control's own ink mixed into its own ground, at
//              --state-hover-share, behind `@media (hover: hover)`. A control
//              set as TEXT takes no tint — its hover is ink and underline.
//   Focus      the 3px accent ring, drawn by the one :focus-visible rule in
//              index.css. A control never draws its own and never removes it.
//   Press      scale 0.98 at --motion-fast, only when motion is welcome and
//              the action is available. The firmer tint also works without
//              motion. Compact colour changes use the same short duration.
//   Selected   the bold weight, plus a second signal: the selected tint on
//              `aria-pressed`, the filled ground on `aria-checked`, the
//              strong rule on `aria-selected`. Never colour alone.
//   Disabled   `disabled` where the control must not act; `aria-disabled`
//              where it must stay focusable to explain itself, and then its
//              handler refuses every activation path. The disabled ink on
//              the alternate ground, the pointer unchanged. Never removed.
//   Busy       `aria-busy="true"` with descriptive progress text. The action
//              keeps its colour hierarchy, accepts no further activation,
//              and stays focusable where `aria-disabled` is appropriate.
//   Error      the field states it, not the button: see components/forms.
//
// Availability and motion live in CSS so a busy action is never mistaken
// for an unavailable one, and a disabled press cannot scale the control.
import './publicControls.css';

/**
 * Selected: the weight, so the state is never colour alone. `aria-pressed`
 * also takes the tint (it has no ground of its own); `aria-checked` and
 * `aria-selected` take the segmented control's filled ground and the tab's
 * strong rule instead.
 */
const selectedClass = 'aria-pressed:font-bold aria-checked:font-bold aria-selected:font-bold';

/** Every state a BOXED control shares. Compose it into each shape below. */
export const controlStateClass =
  `public-action control-tint ${selectedClass}`;

/**
 * The same states for a control set as TEXT — a control in a schedule row,
 * say, where the row's own rhythm is the design and a boxed control would be
 * a second grid competing with the programme.
 *
 * It takes no tint and no ground: a tint behind running text is a box, and
 * the point of the text register is that nothing on the row is boxed. Its
 * hover is the ink and the underline the shape already carries.
 */
export const textControlStateClass =
  `public-text-control ${selectedClass}`;

// A form control's boundary is --color-border-control, not --rule-hairline
// (design brief §8.1 polish, WCAG 1.4.11): a rule is tuned for low-contrast
// section dividers, and a control's boundary needs 3:1 against its ground.
export const inputClass =
  'public-field touch-target w-full rounded-brand border-hairline border-control bg-surface px-sm py-xs ' +
  'font-body text-body text-text-primary placeholder:text-text-secondary ' +
  'aria-[invalid=true]:border-danger';

/** The filled primary action. Sized by its own content. */
export const primaryActionClass =
  `${controlStateClass} touch-target inline-flex items-center justify-center gap-xs rounded-brand ` +
  'border-hairline border-transparent bg-accent px-md py-xs font-data text-caption font-semibold text-surface';

/** The outlined action that sits beside a primary one. */
export const secondaryActionClass =
  `${controlStateClass} touch-target inline-flex items-center justify-center gap-xs rounded-brand ` +
  'border-hairline border-control bg-surface px-md py-xs font-data text-caption ' +
  'font-semibold text-text-primary';

/**
 * A page-level action in the editorial register: a ruled rectangle with no
 * fill, for a control that offers something rather than completing a task.
 */
export const quietActionClass =
  `${controlStateClass} touch-target inline-flex items-center justify-center gap-xs rounded-brand border-hairline ` +
  'border-control px-md py-2xs font-data text-caption font-medium text-text-primary';

/** The same two actions across a form's full width, for a submit row. */
export const primaryButtonClass = `${primaryActionClass} w-full`;
export const secondaryButtonClass = `${secondaryActionClass} w-full`;
