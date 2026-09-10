// The radio: the one round shape the system draws, because a circle is the
// radio's universal form and the reason a reader can tell "pick one" from
// "pick any" before reading a word.
import { useState } from 'react';
import { Radio } from '../../../components/forms/Choice.jsx';
import { fieldRegister } from './states.js';
import { eventConfig } from '@generated/eventConfig.js';

function RadioSpecimen({ state }) {
  const [track, setTrack] = useState(
    state === 'selected' ? eventConfig.tracks[0].letter : '',
  );
  return (
    <fieldset className="flex flex-col gap-3xs">
      <legend className="font-data text-caption font-semibold text-text-primary">Track</legend>
      {eventConfig.tracks.map((entry, index) => (
        <Radio
          key={entry.letter}
          name={`specimen-track-${state}`}
          label={`${entry.letter} · ${entry.name}`}
          value={entry.letter}
          checked={state === 'error' ? false : track === entry.letter}
          disabled={state === 'disabled'}
          error={
            state === 'error' && index === eventConfig.tracks.length - 1
              ? 'Pick the track this session belongs to.'
              : undefined
          }
          onChange={(event) => setTrack(event.target.value)}
        />
      ))}
    </fieldset>
  );
}

export default Object.freeze({
  id: 'radio',
  name: 'Radio',
  file: 'components/forms/Choice.jsx',
  contract: '--color-border-control-rgb',
  note: 'Pick one. Drawn from the same tokens as the checkbox, with the platform’s own group keyboard under it. The dot reads currentColor, so it takes the ink of whatever ground it lands on.',
  states: Object.freeze(['rest', 'selected', 'disabled', 'error']),
  absent: Object.freeze([
    fieldRegister('hover'),
    fieldRegister('focus'),
    fieldRegister('pressed'),
    Object.freeze({
      state: 'busy',
      reason: 'A radio waits for the submit beside it. The submit carries the busy state.',
    }),
    Object.freeze({ state: 'success', reason: 'The form states its result in place once the submit returns.' }),
    Object.freeze({ state: 'empty', reason: 'A group with no choices in it is not drawn.' }),
  ]),
  render: (state) => <RadioSpecimen state={state} />,
});
