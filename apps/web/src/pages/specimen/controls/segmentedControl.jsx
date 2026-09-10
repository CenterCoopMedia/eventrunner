// One choice from a short set, as one ruled row of words.
import { useState } from 'react';
import SegmentedControl from '../../../components/forms/SegmentedControl.jsx';
import { sharedGrammar } from './states.js';
import { specimenDays } from '../exampleContent.js';
import { eventConfig } from '@generated/eventConfig.js';

// `days` may be an empty array on an event that has not published its
// programme yet, and one word is not a row of choices.
const OPTIONS = specimenDays(eventConfig).map((day) => ({ value: day.id, label: day.label }));

function SegmentedSpecimen({ state }) {
  // Rest opens on the first day and selected on the second, so a reviewer
  // sees the filled ground follow the choice rather than sitting still.
  const [value, setValue] = useState(
    state === 'selected' ? (OPTIONS[1] ?? OPTIONS[0]).value : OPTIONS[0].value,
  );
  return (
    <SegmentedControl label="Day" options={OPTIONS} value={value} onChange={setValue} />
  );
}

export default Object.freeze({
  id: 'segmented-control',
  name: 'Segmented control',
  file: 'components/forms/SegmentedControl.jsx',
  contract: null,
  note: 'A radio group set as one ruled row. One tab stop; the arrow keys move and choose inside it. The chosen word takes the filled ground and the bold weight, so the state is never colour alone.',
  states: Object.freeze(['rest', 'selected']),
  absent: Object.freeze([
    sharedGrammar('hover'),
    sharedGrammar('focus'),
    sharedGrammar('pressed'),
    Object.freeze({
      state: 'disabled',
      reason: 'The component takes no disabled prop. A facet with no choices left is not rendered at all rather than rendered dead.',
    }),
    Object.freeze({
      state: 'busy',
      reason: 'The choice lands at once and the list under it resolves; the count beside the list is what states the result.',
    }),
    Object.freeze({ state: 'error', reason: 'One of the words is always chosen, so there is no value to refuse.' }),
    Object.freeze({ state: 'success', reason: 'The filled ground is the result.' }),
    Object.freeze({ state: 'empty', reason: 'A row with nothing in it is not drawn.' }),
  ]),
  render: (state) => <SegmentedSpecimen state={state} />,
});
