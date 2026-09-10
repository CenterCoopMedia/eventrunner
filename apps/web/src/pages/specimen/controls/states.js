// The six states every control declares, in the order the book shows them.
//
// Three of them are real: disabled and busy are attributes, and rest is the
// class string with nothing added. The other three cannot be produced by a
// static page — a printed capture cannot hover, focus, or hold a press — so
// the book forces each one by adding the utilities that state normally
// applies. The utilities are written out as whole class names, because a
// name assembled at runtime is a name the build cannot see.
export const CONTROL_STATES = Object.freeze([
  Object.freeze({ id: 'rest', label: 'Rest' }),
  Object.freeze({ id: 'hover', label: 'Hover' }),
  Object.freeze({ id: 'focus', label: 'Focus-visible' }),
  Object.freeze({ id: 'pressed', label: 'Pressed' }),
  Object.freeze({ id: 'disabled', label: 'Disabled' }),
  Object.freeze({ id: 'busy', label: 'Busy' }),
]);

/** The forced focus ring: the same outline the base layer draws. */
export const FORCED_FOCUS = 'outline outline-2 outline-offset-2 outline-accent';

/** The forced press: the scale the motion grammar gives a press. */
export const FORCED_PRESS = 'scale-[0.98]';

export const STATE_IDS = Object.freeze(CONTROL_STATES.map((state) => state.id));
