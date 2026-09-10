// The states a control declares, in the order the record names them.
//
// The expansion record §2.1 fixes ten states for every control and every
// interactive row. This is that list, and it is the book's contract: a
// control specimen either DRAWS a state or NAMES it as absent with a
// reason, and `index.test.js` fails when a control accounts for neither.
// A missing state that nobody had to explain is how a grammar quietly
// stops being a grammar.
//
// Three of the ten are attributes or values a still page can produce:
// disabled, busy, and whatever the component's own props express. Three of
// them — hover, focus, and press — cannot be produced by a printed capture,
// so the book forces them with the utilities the state normally applies.
// The utilities are written out as whole class names, because a name
// assembled at runtime is a name the build cannot see.
//
// FORCING A TINT IS NOT PAINTING A COLOUR. The hover, press, and selected
// tints are one custom property that the shared rule mixes into whatever
// ground the control already sits on (`.control-tint` in index.css), so the
// book sets THAT property rather than a background utility. A background
// utility would show a colour the control never actually takes, and the
// first capture of the wave found exactly that fault: a fixed ink that
// barely moved a filled action.

/** The ten states, in the record's own order. */
export const CONTROL_STATES = Object.freeze([
  Object.freeze({ id: 'rest', label: 'Rest' }),
  Object.freeze({ id: 'hover', label: 'Hover' }),
  Object.freeze({ id: 'focus', label: 'Focus-visible' }),
  Object.freeze({ id: 'pressed', label: 'Pressed' }),
  Object.freeze({ id: 'selected', label: 'Selected' }),
  Object.freeze({ id: 'disabled', label: 'Unavailable' }),
  Object.freeze({ id: 'busy', label: 'Busy' }),
  Object.freeze({ id: 'error', label: 'Error' }),
  Object.freeze({ id: 'success', label: 'Success' }),
  Object.freeze({ id: 'empty', label: 'Empty' }),
]);

export const STATE_IDS = Object.freeze(CONTROL_STATES.map((state) => state.id));

/** A state's own label, for a caption that names one. */
export function stateLabel(id) {
  return CONTROL_STATES.find((state) => state.id === id)?.label ?? id;
}

/**
 * The forced focus ring.
 *
 * It is ONE CLASS, and that class repeats the shipped :focus-visible
 * declarations (`.focus-ring-forced` in index.css). It used to be a set of
 * outline utilities, and they drew a 2px ring at 2px offset while the rule
 * draws --focus-ring-width, which is 3px — under a table in this same
 * section printing "Ring width 3px". A book that draws a state the product
 * does not draw is worse than a book with no state at all.
 */
export const FORCED_FOCUS = 'focus-ring-forced';

/** The forced press: the scale the motion grammar gives a press. */
export const FORCED_PRESS = 'scale-[0.98]';

/**
 * The tint a state applies, as the custom property the shared rule reads.
 *
 * @param {string} state
 * @returns {Record<string, string> | undefined} a style object, or nothing
 */
export function forcedTint(state) {
  if (state === 'hover') return { '--control-tint-share': 'var(--state-hover-share)' };
  if (state === 'pressed') return { '--control-tint-share': 'var(--state-pressed-share)' };
  if (state === 'selected') return { '--control-tint-share': 'var(--state-selected-share)' };
  return undefined;
}

/**
 * TWO REGISTERS, TWO REASONS.
 *
 * Hover, focus, and press are not decisions a control makes, and a control
 * that does not draw them says so with the reason its own register gives.
 * There are two registers, and the difference is load-bearing:
 *
 *   A BOXED control composes `controlStateClass` (components/
 *   controlClasses.js): the switch's track, a segmented option, a tab. It
 *   really does take the shared tint and the shared press, so drawing them
 *   again under each one would show the same rule six more times.
 *
 *   A FIELD composes none of it. `inputClass` carries no `control-tint`
 *   and no press class, and neither does `.control-choice` — so the
 *   checkbox, the radio, the select, the search field and the filter group
 *   do NOT take the tint, and the shared reason was a false statement about
 *   them. A field draws no hover state at all: its state changes are the
 *   one focus ring and the error rule.
 *
 * Focus is neither register's: it is a single `:focus-visible` rule on
 * every element in index.css, which is why both registers say the same
 * thing about it.
 */
const FOCUS_REASON =
  'Focus-visible is the one ring: a single :focus-visible rule in index.css draws it on every '
  + 'element, and no control adds it, redraws it, or removes it. The shared shapes above show it.';

const FIELD_REASONS = Object.freeze({
  hover:
    'A field takes no tint. A tint behind a field would compete with the value inside it, so a '
    + 'field draws no hover state at all: its state changes are the one focus ring and the error '
    + 'rule. The tinted hover every boxed control composes is drawn on the shared shapes above.',
  pressed:
    'A field holds a value rather than an action, so there is nothing to press. The press is drawn '
    + 'on the shared shapes above, and an action beside a field — a clear control, a submit — '
    + 'takes it from there.',
});

/**
 * The reason a control that COMPOSES the shared grammar does not redraw it.
 *
 * @param {string} state
 * @returns {{ state: string, reason: string }}
 */
export function sharedGrammar(state) {
  if (state === 'focus') return Object.freeze({ state, reason: FOCUS_REASON });
  return Object.freeze({
    state,
    reason: `${stateLabel(state)} is one rule every boxed control composes, drawn on the shared shapes above.`,
  });
}

/**
 * The reason a FIELD does not draw one of the three forced states.
 *
 * It covers hover, focus and press, and it REFUSES anything else. It used
 * to hand back `{ reason: undefined }`, which reaches the book as a state
 * named under the grid with no reason under it — the exact silence the
 * second list exists to end, and a defect that would ship looking like a
 * layout slip.
 *
 * @param {string} state
 * @returns {{ state: string, reason: string }}
 * @throws {Error} where the register holds no reason for that state
 */
export function fieldRegister(state) {
  if (state === 'focus') return Object.freeze({ state, reason: FOCUS_REASON });
  const reason = Object.hasOwn(FIELD_REASONS, state) ? FIELD_REASONS[state] : null;
  if (typeof reason !== 'string') {
    throw new Error(
      `fieldRegister: the field register has no reason for the "${state}" state. `
      + 'It covers hover, focus and pressed; give the control its own reason for anything else.',
    );
  }
  return Object.freeze({ state, reason });
}

/** The two register reasons, for the registry's own test. */
export const REGISTER_REASONS = Object.freeze({ focus: FOCUS_REASON, field: FIELD_REASONS });

export default CONTROL_STATES;
