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

/** The forced focus ring: the same outline the base layer draws. */
export const FORCED_FOCUS = 'outline outline-2 outline-offset-2 outline-accent';

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
 * The reason a control does not draw one of the three shared states.
 *
 * Hover, focus, and press are not decisions a control makes. They are one
 * rule string every boxed control composes (`controlStateClass` in
 * components/controlClasses.js), drawn on the shared shapes at the head of
 * the section. Drawing them again on each composed control would show the
 * same rule six more times and say nothing new.
 *
 * @param {string} state
 * @returns {{ state: string, reason: string }}
 */
export function sharedGrammar(state) {
  return {
    state,
    reason: `${stateLabel(state)} is one rule every boxed control composes, drawn on the shared shapes above.`,
  };
}

export default CONTROL_STATES;
