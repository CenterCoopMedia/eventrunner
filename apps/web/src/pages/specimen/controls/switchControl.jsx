// A setting that is on or off.
import { useState } from 'react';
import Switch from '../../../components/forms/Switch.jsx';
import { sharedGrammar } from './states.js';

function SwitchSpecimen({ state }) {
  const [checked, setChecked] = useState(state === 'selected');
  return (
    <Switch
      label="Send me the daily programme"
      hint="One message each morning of the event."
      checked={checked}
      onChange={setChecked}
      disabled={state === 'disabled'}
    />
  );
}

export default Object.freeze({
  id: 'switch',
  name: 'Switch',
  file: 'components/forms/Switch.jsx',
  contract: null,
  note: 'role="switch" with aria-checked. The word carries the state to everybody else, so nothing is a shape a reader has to interpret. No sliding knob.',
  states: Object.freeze(['rest', 'selected', 'disabled']),
  absent: Object.freeze([
    sharedGrammar('hover'),
    sharedGrammar('focus'),
    sharedGrammar('pressed'),
    Object.freeze({
      state: 'busy',
      reason: 'A switch takes effect the moment it is thrown. A setting that had to wait for a request would be a checkbox with a submit beside it.',
    }),
    Object.freeze({
      state: 'error',
      reason: 'A switch holds no value that can be wrong. An error belongs to the form the setting sits in.',
    }),
    Object.freeze({ state: 'success', reason: 'The word beside the label is the result.' }),
    Object.freeze({ state: 'empty', reason: 'A switch has no list to be empty.' }),
  ]),
  render: (state) => <SwitchSpecimen state={state} />,
});
