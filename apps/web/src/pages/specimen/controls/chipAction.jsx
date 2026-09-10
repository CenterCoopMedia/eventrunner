// The one boxed control that holds a choice: the reaction chip.
//
// It survives as a box in exactly one place — the reaction group on a
// session's detail page — where a set of small pressed and unpressed
// targets needs a visible edge to read as a set. It never appears on a row.
//
// It is also the shape that carries the SELECTED state of the grammar: a
// chip a reader has pressed takes the selected tint and the bold weight, so
// the state is a ground and a weight rather than a colour on its own.
import { chipActionClass } from '../../../components/session/sessionActionClass.js';
import { FORCED_FOCUS, FORCED_PRESS, forcedTint } from './states.js';

const CLASS_FOR_STATE = Object.freeze({
  rest: chipActionClass,
  hover: chipActionClass,
  focus: `${chipActionClass} ${FORCED_FOCUS}`,
  pressed: `${chipActionClass} ${FORCED_PRESS}`,
  selected: chipActionClass,
  disabled: chipActionClass,
});

export default Object.freeze({
  id: 'chip-action',
  name: 'Chip action',
  file: 'components/session/sessionActionClass.js',
  contract: null,
  note: 'The selected state of the grammar: aria-pressed takes the selected tint and the bold weight. A rectangle on the theme radius, never a pill.',
  states: Object.freeze(['rest', 'hover', 'focus', 'pressed', 'selected', 'disabled']),
  absent: Object.freeze([
    Object.freeze({
      state: 'busy',
      reason: 'A reaction lands at once and is reversed by pressing again; nothing waits on a result to report.',
    }),
    Object.freeze({ state: 'error', reason: 'A failed reaction states itself as a line under the group.' }),
    Object.freeze({ state: 'success', reason: 'The pressed chip and its count are the result.' }),
    Object.freeze({ state: 'empty', reason: 'An empty state belongs to the group, not to one chip.' }),
  ]),
  render: (state) => (
    <button
      type="button"
      className={CLASS_FOR_STATE[state]}
      style={forcedTint(state)}
      disabled={state === 'disabled'}
      aria-disabled={state === 'disabled' ? 'true' : undefined}
      aria-pressed={state === 'selected' ? 'true' : 'false'}
      aria-label="React with a raised hand, 4"
    >
      <span aria-hidden="true">✋</span> 4
    </button>
  ),
});
