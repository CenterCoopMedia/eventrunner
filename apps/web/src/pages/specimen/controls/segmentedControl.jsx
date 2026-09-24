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
  const options =
    state === 'disabled' && OPTIONS.length > 1
      ? OPTIONS.map((option, index) =>
          index === OPTIONS.length - 1
            ? { ...option, disabled: true, hint: 'No sessions published for this day yet' }
            : option,
        )
      : OPTIONS;
  return <SegmentedControl label="Day" options={options} value={value} onChange={setValue} />;
}

export default Object.freeze({
  id: 'segmented-control',
  name: 'Segmented control',
  file: 'components/forms/SegmentedControl.jsx',
  contract: null,
  note: 'A radio group set as one ruled row. One tab stop; the arrow keys move and choose inside it. The chosen word takes the filled ground and the bold weight, so the state is never colour alone. An unavailable choice stays in the row with aria-disabled under a dashed rule: the arrow keys land on it, a reader hears why, a sighted reader sees the reason under the row while it has focus or the pointer, and it is never chosen.',
  states: Object.freeze(['rest', 'selected', 'disabled']),
  absent: Object.freeze([
    sharedGrammar('hover'),
    sharedGrammar('focus'),
    sharedGrammar('pressed'),
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
