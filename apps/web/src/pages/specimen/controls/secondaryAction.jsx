// The outlined action that sits beside a primary one.
import { secondaryActionClass } from '../../../components/controlClasses.js';
import { FORCED_FOCUS, FORCED_PRESS, forcedTint } from './states.js';

const CLASS_FOR_STATE = Object.freeze({
  rest: secondaryActionClass,
  hover: secondaryActionClass,
  focus: `${secondaryActionClass} ${FORCED_FOCUS}`,
  pressed: `${secondaryActionClass} ${FORCED_PRESS}`,
  disabled: secondaryActionClass,
  busy: secondaryActionClass,
});

export default Object.freeze({
  id: 'secondary-action',
  name: 'Secondary action',
  file: 'components/controlClasses.js',
  contract: null,
  note: 'The second choice on a submit row. Same size as the primary action, no fill.',
  states: Object.freeze(['rest', 'hover', 'focus', 'pressed', 'disabled', 'busy']),
  absent: Object.freeze([
    Object.freeze({
      state: 'selected',
      reason: 'It offers a second way out of a task rather than holding a choice.',
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
      {state === 'busy' ? 'Saving…' : 'Save for later'}
    </button>
  ),
});
