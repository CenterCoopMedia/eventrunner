// Send a file: a ruled region around a real file input.
import { useState } from 'react';
import Dropzone from '../../../components/forms/Dropzone.jsx';
import { fieldRegister } from './states.js';

const SENT_FOR_STATE = Object.freeze({
  busy: [
    { id: 'deck', name: 'opening-deck.pdf', state: 'sent' },
    { id: 'notes', name: 'speaker-notes.pdf', state: 'sending' },
  ],
  success: [
    { id: 'deck', name: 'opening-deck.pdf', state: 'sent' },
    { id: 'notes', name: 'speaker-notes.pdf', state: 'sent' },
  ],
  error: [{ id: 'deck', name: 'opening-deck.pdf', state: 'failed', detail: 'Too large.' }],
});

function DropzoneSpecimen({ state }) {
  const [picked, setPicked] = useState([]);
  const sent = SENT_FOR_STATE[state] ?? picked;
  return (
    <Dropzone
      label="Session slides"
      hint="PDF, up to 5 MB."
      accept={['application/pdf']}
      multiple
      disabled={state === 'disabled'}
      progress={state === 'busy' ? { value: 1, max: 2 } : null}
      sent={sent}
      error={state === 'error' ? 'That file is 9 MB. The limit is 5 MB.' : undefined}
      onFiles={(files) =>
        setPicked(files.map((file) => ({ id: file.name, name: file.name, state: 'sent' })))
      }
    />
  );
}

export default Object.freeze({
  id: 'dropzone',
  name: 'Dropzone',
  file: 'components/forms/Dropzone.jsx',
  contract: 'dropzone',
  note: 'A real file input inside a ruled region; the region takes the one focus ring while the input has focus. Progress is a stated line with a progress element and the region says it is busy; each sent file carries a state word in one status region. The rule is dashed at rest and solid at the strong width while a file is held over it, and a refusal draws the strong rule in the danger ink as well as its sentence.',
  states: Object.freeze(['rest', 'disabled', 'busy', 'error', 'success']),
  absent: Object.freeze([
    fieldRegister('hover'),
    fieldRegister('focus'),
    fieldRegister('pressed'),
    Object.freeze({
      state: 'selected',
      reason: 'A file is sent, not selected. The sent list under the region is the record of what went.',
    }),
    Object.freeze({
      state: 'empty',
      reason: 'A region with nothing sent yet is its rest state: the invitation to drop a file is the empty state.',
    }),
  ]),
  render: (state) => <DropzoneSpecimen state={state} />,
});
