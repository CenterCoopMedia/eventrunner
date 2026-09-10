// One panel from a short set, on the ARIA tab pattern.
import { useState } from 'react';
import { Tab, TabList, TabPanel, Tabs } from '../../../components/forms/Tabs.jsx';
import { sharedGrammar } from './states.js';
import { eventConfig } from '@generated/eventConfig.js';

const TABS = eventConfig.tracks.map((track) => ({
  id: track.letter,
  label: `${track.letter} · ${track.name}`,
}));

const IDS = TABS.map((tab) => tab.id);

function TabsSpecimen({ state }) {
  const [open, setOpen] = useState(state === 'selected' ? IDS[1] : IDS[0]);
  return (
    <Tabs value={open} onChange={setOpen} tabs={IDS}>
      <TabList label="Track">
        {TABS.map((tab) => (
          <Tab key={tab.id} id={tab.id}>
            {tab.label}
          </Tab>
        ))}
      </TabList>
      {TABS.map((tab) => (
        <TabPanel key={tab.id} id={tab.id}>
          <p className="max-w-prose text-body text-text-primary">
            The sessions in the {tab.label} track.
          </p>
        </TabPanel>
      ))}
    </Tabs>
  );
}

export default Object.freeze({
  id: 'tabs',
  name: 'Tabs',
  file: 'components/forms/Tabs.jsx',
  contract: null,
  note: 'The open word carries the strong rule — the same boundary a section head takes — so the row reads as the page’s own typography. One tab stop, arrow keys along the row, never a pill.',
  states: Object.freeze(['rest', 'selected']),
  absent: Object.freeze([
    sharedGrammar('hover'),
    sharedGrammar('focus'),
    sharedGrammar('pressed'),
    Object.freeze({
      state: 'disabled',
      reason: 'A tab with nothing behind it is not rendered. A row that points at an empty panel is a dead end.',
    }),
    Object.freeze({
      state: 'busy',
      reason: 'Selection follows focus and the panel is already in the document, so nothing waits.',
    }),
    Object.freeze({ state: 'error', reason: 'A tab holds no value to refuse; the panel’s own form states its errors.' }),
    Object.freeze({ state: 'success', reason: 'The open panel is the result.' }),
    Object.freeze({
      state: 'empty',
      reason: 'An open panel with nothing in it draws the empty state of whatever list it holds.',
    }),
  ]),
  render: (state) => <TabsSpecimen state={state} />,
});
