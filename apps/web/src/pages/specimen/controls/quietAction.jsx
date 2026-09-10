// The page-level action in the editorial register: a ruled rectangle, no fill.
import { quietActionClass } from '../../../components/controlClasses.js';
import { FORCED_FOCUS, FORCED_PRESS, forcedTint } from './states.js';

const CLASS_FOR_STATE = Object.freeze({
  rest: quietActionClass,
  hover: quietActionClass,
  focus: `${quietActionClass} ${FORCED_FOCUS}`,
  pressed: `${quietActionClass} ${FORCED_PRESS}`,
  disabled: quietActionClass,
  busy: quietActionClass,
});

export default Object.freeze({
  id: 'quiet-action',
  name: 'Quiet action',
  file: 'components/controlClasses.js',
  contract: null,
  note: 'A control that offers something rather than completing a task. The header register.',
  states: Object.freeze(['rest', 'hover', 'focus', 'pressed', 'disabled', 'busy']),
  absent: Object.freeze([
    Object.freeze({
      state: 'selected',
      reason: 'It opens something rather than holding a choice.',
    }),
    Object.freeze({ state: 'error', reason: 'The field states an error, never the control beside it.' }),
    Object.freeze({ state: 'success', reason: 'The result is a stated line in place, drawn in Feedback.' }),
    Object.freeze({ state: 'empty', reason: 'An empty state belongs to a list, not to a control.' }),
  ]),
  render: (state) => (
    <button
      type="button"
      className={CLASS_FOR_STATE[state]}
      style={forcedTint(state)}
      disabled={state === 'disabled'}
      aria-disabled={state === 'disabled' ? 'true' : undefined}
      aria-busy={state === 'busy' ? 'true' : undefined}
    >
      {state === 'busy' ? 'Opening…' : 'Add to calendar'}
    </button>
  ),
});
