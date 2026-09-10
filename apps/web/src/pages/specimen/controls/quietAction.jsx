// The page-level action in the editorial register: a ruled rectangle, no fill.
import { quietActionClass } from '../../../components/controlClasses.js';
import { FORCED_FOCUS, FORCED_PRESS } from './states.js';

const CLASS_FOR_STATE = Object.freeze({
  rest: quietActionClass,
  hover: `${quietActionClass} !bg-surface-alt`,
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
  render: (state) => (
    <button
      type="button"
      className={CLASS_FOR_STATE[state]}
      disabled={state === 'disabled'}
      aria-disabled={state === 'disabled' ? 'true' : undefined}
      aria-busy={state === 'busy' ? 'true' : undefined}
    >
      {state === 'busy' ? 'Opening…' : 'Add to calendar'}
    </button>
  ),
});
