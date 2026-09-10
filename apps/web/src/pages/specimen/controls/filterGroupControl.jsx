// Narrow a list by a facet.
import { useState } from 'react';
import FilterGroup from '../../../components/forms/FilterGroup.jsx';
import { fieldRegister } from './states.js';
import { specimenPlaces } from '../exampleContent.js';
import { eventConfig } from '@generated/eventConfig.js';

// `venue.places` is optional, and an event that records one room is as
// valid as one that records twenty — so the count list is read by index
// rather than assumed to have three entries under it.
const COUNTS = Object.freeze([12, 7, 5]);
const OPTIONS = specimenPlaces(eventConfig).slice(0, COUNTS.length).map((place, index) => ({
  value: place.id,
  label: place.name,
  count: COUNTS[index],
}));

function FilterSpecimen({ state }) {
  const [selected, setSelected] = useState(
    state === 'selected'
      ? [...new Set([OPTIONS[0].value, OPTIONS.at(-1).value])]
      : [],
  );
  return (
    <FilterGroup
      legend="Room"
      options={OPTIONS}
      selected={selected}
      onChange={setSelected}
      clearLabel="Clear rooms"
    />
  );
}

export default Object.freeze({
  id: 'filter-group',
  name: 'Filter group',
  file: 'components/forms/FilterGroup.jsx',
  contract: null,
  note: 'A real fieldset and legend, with the count of what is on inside the legend and one clear control for the whole group. A reader who scrolls past and back learns in one glance whether the filter is doing anything.',
  states: Object.freeze(['rest', 'selected']),
  absent: Object.freeze([
    fieldRegister('hover'),
    fieldRegister('focus'),
    fieldRegister('pressed'),
    Object.freeze({
      state: 'disabled',
      reason: 'A facet with no options is not rendered. The clear control appears only when something is on, so it is never a control that does nothing.',
    }),
    Object.freeze({
      state: 'busy',
      reason: 'The list narrows in the page, with no request to wait on.',
    }),
    Object.freeze({ state: 'error', reason: 'A facet holds no value that can be wrong.' }),
    Object.freeze({ state: 'success', reason: 'The count in the legend and the narrowed list are the result.' }),
    Object.freeze({
      state: 'empty',
      reason: 'A filter that matches nothing states it in the list’s own empty state, drawn in Feedback.',
    }),
  ]),
  render: (state) => <FilterSpecimen state={state} />,
});
