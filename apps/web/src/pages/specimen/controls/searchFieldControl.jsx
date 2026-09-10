// Narrow a list by words.
import { useState } from 'react';
import SearchField from '../../../components/forms/SearchField.jsx';
import { fieldRegister } from './states.js';

const QUERY_FOR_STATE = Object.freeze({
  rest: '',
  success: 'opening',
  empty: 'lithography',
});

const STATUS_FOR_STATE = Object.freeze({
  rest: '24 sessions in the programme.',
  success: '3 sessions match “opening”.',
  empty: 'No session matches “lithography”. Clear the search to read the whole programme.',
});

function SearchSpecimen({ state }) {
  const [value, setValue] = useState(QUERY_FOR_STATE[state] ?? '');
  return (
    <SearchField
      label="Search the programme"
      placeholder="Session, speaker, or room"
      value={value}
      onChange={setValue}
      status={value === QUERY_FOR_STATE[state] ? STATUS_FOR_STATE[state] : `Searching for “${value}”.`}
    />
  );
}

export default Object.freeze({
  id: 'search-field',
  name: 'Search field',
  file: 'components/forms/SearchField.jsx',
  contract: '--color-border-control-rgb',
  note: 'The count is spoken as well as shown: it sits in a role="status" line that is always in the document, so a reader’s assistive technology is already watching when the first count lands. The clear control is a real button, and it is drawn only when there is something to clear.',
  states: Object.freeze(['rest', 'success', 'empty']),
  absent: Object.freeze([
    fieldRegister('hover'),
    fieldRegister('focus'),
    fieldRegister('pressed'),
    Object.freeze({
      state: 'selected',
      reason: 'A query is a value, not a choice. The filter group beside it is what holds a selection.',
    }),
    Object.freeze({
      state: 'disabled',
      reason: 'A search over an empty list is not drawn at all; a field that refuses to be typed in is a dead end.',
    }),
    Object.freeze({
      state: 'busy',
      reason: 'The list narrows as the query is typed, in the page, with no request to wait on.',
    }),
    Object.freeze({
      state: 'error',
      reason: 'A query cannot be wrong. A query that matches nothing is the empty state beside this one.',
    }),
  ]),
  render: (state) => <SearchSpecimen state={state} />,
});
