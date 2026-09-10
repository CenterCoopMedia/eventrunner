// The checkbox, drawn from the tokens rather than painted by the system.
import { useState } from 'react';
import { Checkbox } from '../../../components/forms/Choice.jsx';
import { sharedGrammar } from './states.js';

function CheckboxSpecimen({ state }) {
  const [checked, setChecked] = useState(state === 'selected');
  return (
    <Checkbox
      label="Send me the daily programme"
      description="One message each morning of the event."
      checked={state === 'error' ? false : checked}
      disabled={state === 'disabled'}
      error={state === 'error' ? 'Choose at least one way to hear from us.' : undefined}
      onChange={(event) => setChecked(event.target.checked)}
    />
  );
}

export default Object.freeze({
  id: 'checkbox',
  name: 'Checkbox',
  file: 'components/forms/Choice.jsx',
  contract: '--color-border-control-rgb',
  note: 'Pick any. The native paint is turned off and the box is redrawn from the tokens, so a client’s palette and dark mode reach it. The input under the paint is untouched, so the keyboard, the label and the form stay the browser’s.',
  states: Object.freeze(['rest', 'selected', 'disabled', 'error']),
  absent: Object.freeze([
    sharedGrammar('hover'),
    sharedGrammar('focus'),
    sharedGrammar('pressed'),
    Object.freeze({
      state: 'busy',
      reason: 'A checkbox waits for the submit beside it. The submit carries the busy state.',
    }),
    Object.freeze({ state: 'success', reason: 'The form states its result in place once the submit returns.' }),
    Object.freeze({ state: 'empty', reason: 'An empty state belongs to the group, not to one box.' }),
  ]),
  render: (state) => <CheckboxSpecimen state={state} />,
});
