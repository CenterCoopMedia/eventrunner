// The outlined action that sits beside a primary one.
import { secondaryActionClass } from '../../../components/controlClasses.js';
import { FORCED_FOCUS, FORCED_PRESS } from './states.js';

const CLASS_FOR_STATE = Object.freeze({
  rest: secondaryActionClass,
  hover: `${secondaryActionClass} !bg-surface-alt`,
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
  render: (state) => (
    <button
      type="button"
      className={CLASS_FOR_STATE[state]}
      disabled={state === 'disabled'}
      aria-disabled={state === 'disabled' ? 'true' : undefined}
      aria-busy={state === 'busy' ? 'true' : undefined}
    >
      {state === 'busy' ? 'Saving…' : 'Save for later'}
    </button>
  ),
});
