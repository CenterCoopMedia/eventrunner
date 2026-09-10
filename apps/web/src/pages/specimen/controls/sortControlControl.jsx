// Order a list.
import { useState } from 'react';
import SortControl from '../../../components/forms/SortControl.jsx';
import { sharedGrammar } from './states.js';

const OPTIONS = Object.freeze([
  Object.freeze({ value: 'time', label: 'Start time' }),
  Object.freeze({ value: 'title', label: 'Session title' }),
  Object.freeze({ value: 'room', label: 'Room' }),
]);

function SortSpecimen({ state }) {
  const [value, setValue] = useState(state === 'selected' ? OPTIONS[1].value : OPTIONS[0].value);
  return (
    <SortControl label="Sort sessions" options={OPTIONS} value={value} onChange={setValue} />
  );
}

export default Object.freeze({
  id: 'sort-control',
  name: 'Sort control',
  file: 'components/forms/SortControl.jsx',
  contract: '--color-border-control-rgb',
  note: 'A labelled select, because an order is one choice from a set a reader does not need to see all at once. The label states what is being ordered — “Sort sessions”, never “Sort by” — so a reader who lands on it out of context still knows.',
  states: Object.freeze(['rest', 'selected']),
  absent: Object.freeze([
    sharedGrammar('hover'),
    sharedGrammar('focus'),
    sharedGrammar('pressed'),
    Object.freeze({
      state: 'disabled',
      reason: 'The select’s own unavailable state is drawn with the other fields in Inputs.',
    }),
    Object.freeze({
      state: 'busy',
      reason: 'The list reorders in the page. Nothing waits on a request.',
    }),
    Object.freeze({
      state: 'error',
      reason: 'One of the orders is always chosen, so there is no value to refuse.',
    }),
    Object.freeze({ state: 'success', reason: 'The reordered list is the result.' }),
    Object.freeze({ state: 'empty', reason: 'A control that orders nothing is not drawn.' }),
  ]),
  render: (state) => <SortSpecimen state={state} />,
});
