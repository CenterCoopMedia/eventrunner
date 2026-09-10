// The filled primary action.
import { primaryActionClass } from '../../../components/controlClasses.js';
import { FORCED_FOCUS, FORCED_PRESS, forcedTint } from './states.js';

const CLASS_FOR_STATE = Object.freeze({
  rest: primaryActionClass,
  hover: primaryActionClass,
  focus: `${primaryActionClass} ${FORCED_FOCUS}`,
  pressed: `${primaryActionClass} ${FORCED_PRESS}`,
  disabled: primaryActionClass,
  busy: primaryActionClass,
});

export default Object.freeze({
  id: 'primary-action',
  name: 'Primary action',
  file: 'components/controlClasses.js',
  contract: null,
  note: 'The one filled control on a page. It completes the task the page is for. Its hover tint is its own label mixed into its own ground, so the step is legible on a fill as well as on a page.',
  states: Object.freeze(['rest', 'hover', 'focus', 'pressed', 'disabled', 'busy']),
  absent: Object.freeze([
    Object.freeze({
      state: 'selected',
      reason: 'A primary action completes a task rather than holding a choice. The chip below is the shape that carries a selection.',
    }),
    Object.freeze({
      state: 'error',
      reason: 'The field states an error, never the control that submits it. Pressing Save with a bad value sends nothing and moves the reader to the field that refused.',
    }),
    Object.freeze({
      state: 'success',
      reason: 'The result is a stated line in place beside the control, drawn in Feedback.',
    }),
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
      {state === 'busy' ? 'Registering…' : 'Register'}
    </button>
  ),
});
