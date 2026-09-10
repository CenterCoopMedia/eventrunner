// The filled primary action.
import { primaryActionClass } from '../../../components/controlClasses.js';
import { FORCED_FOCUS, FORCED_PRESS } from './states.js';

const CLASS_FOR_STATE = Object.freeze({
  rest: primaryActionClass,
  hover: `${primaryActionClass} !bg-accent-strong`,
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
  note: 'The one filled control on a page. It completes the task the page is for.',
  render: (state) => (
    <button
      type="button"
      className={CLASS_FOR_STATE[state]}
      disabled={state === 'disabled'}
      aria-disabled={state === 'disabled' ? 'true' : undefined}
      aria-busy={state === 'busy' ? 'true' : undefined}
    >
      {state === 'busy' ? 'Registering…' : 'Register'}
    </button>
  ),
});
