// A short list of rows a person adds and removes.
import { useState } from 'react';
import Repeater from '../../../components/forms/Repeater.jsx';
import { TextField } from '../../../components/forms/publicForm.jsx';
import { fieldRegister } from './states.js';

const ROWS_FOR_STATE = Object.freeze({
  rest: [
    { id: 'site', label: 'Newsroom site', url: 'https://example.org' },
    { id: 'feed', label: 'Newsletter', url: 'https://example.org/newsletter' },
  ],
  empty: [],
});

function RepeaterSpecimen({ state }) {
  const [rows, setRows] = useState(ROWS_FOR_STATE[state] ?? ROWS_FOR_STATE.rest);
  const update = (id, patch) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <Repeater
      legend="Links"
      rowName="link"
      max={4}
      addLabel="Add a link"
      emptyLine="No links yet. Add one to show it on your profile."
      rows={rows}
      onAdd={() => setRows((current) => [...current, { id: `link-${Date.now()}`, label: '', url: '' }])}
      onRemove={(id) => setRows((current) => current.filter((row) => row.id !== id))}
      renderRow={(row, index) => (
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField
            label={`Link ${index + 1} label`}
            value={row.label}
            onChange={(label) => update(row.id, { label })}
          />
          <TextField
            label={`Link ${index + 1} address`}
            type="url"
            value={row.url}
            onChange={(url) => update(row.id, { url })}
            error={state === 'error' && index === 0 ? 'Enter a full address, starting with https://.' : undefined}
          />
        </div>
      )}
    />
  );
}

export default Object.freeze({
  id: 'repeater',
  name: 'Repeater',
  file: 'components/forms/Repeater.jsx',
  contract: 'repeater',
  note: 'Each row’s fields are labelled, each row has a remove control that names it, and one add control sits under the list; at the cap it stays, unavailable, and its name states the limit. Focus follows the change: a new row takes focus on its first field, and a removed row hands focus to the row before it or to the add control.',
  states: Object.freeze(['rest', 'error', 'empty']),
  absent: Object.freeze([
    fieldRegister('hover'),
    fieldRegister('focus'),
    fieldRegister('pressed'),
    Object.freeze({ state: 'selected', reason: 'A list of rows holds values, not a choice.' }),
    Object.freeze({
      state: 'disabled',
      reason: 'A list that cannot be edited is drawn as the plain list it stores, not as dead fields.',
    }),
    Object.freeze({
      state: 'busy',
      reason: 'The rows wait for the submit beside them. The submit carries the busy state.',
    }),
    Object.freeze({ state: 'success', reason: 'The form states its result in place once the submit returns.' }),
  ]),
  render: (state) => <RepeaterSpecimen state={state} />,
});
