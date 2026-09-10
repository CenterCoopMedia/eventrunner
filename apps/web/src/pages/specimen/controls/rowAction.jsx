// The control on a schedule row: text in the data face, never a box.
import { rowActionClass } from '../../../components/session/sessionActionClass.js';
import { FORCED_FOCUS, FORCED_PRESS } from './states.js';

const CLASS_FOR_STATE = Object.freeze({
  rest: rowActionClass,
  hover: `${rowActionClass} !text-text-primary underline`,
  focus: `${rowActionClass} ${FORCED_FOCUS}`,
  pressed: `${rowActionClass} ${FORCED_PRESS}`,
  disabled: `${rowActionClass} opacity-60`,
  busy: rowActionClass,
});

export default Object.freeze({
  id: 'row-action',
  name: 'Row action',
  file: 'components/session/sessionActionClass.js',
  contract: null,
  note: 'Nothing on a schedule row is boxed, so the reader keeps running down the time column.',
  render: (state) => (
    <button
      type="button"
      className={CLASS_FOR_STATE[state]}
      disabled={state === 'disabled'}
      aria-disabled={state === 'disabled' ? 'true' : undefined}
      aria-busy={state === 'busy' ? 'true' : undefined}
    >
      {state === 'busy' ? 'Saving…' : 'Save this session'}
    </button>
  ),
});
