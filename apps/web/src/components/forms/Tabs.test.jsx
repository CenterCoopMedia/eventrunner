// The tab pattern: the roving tab index, the arrow keys, and the panel.
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tab, TabList, TabPanel, Tabs } from './Tabs.jsx';

const IDS = ['programme', 'speakers', 'venue'];

function Harness({ start = 'programme' }) {
  const [open, setOpen] = useState(start);
  return (
    <Tabs value={open} onChange={setOpen} tabs={IDS}>
      <TabList label="Event pages">
        <Tab id="programme">Programme</Tab>
        <Tab id="speakers">Speakers</Tab>
        <Tab id="venue">Venue</Tab>
      </TabList>
      <TabPanel id="programme">The running order.</TabPanel>
      <TabPanel id="speakers">Who is talking.</TabPanel>
      <TabPanel id="venue">Where to go.</TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('is a named tab list with one selected tab', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Event pages');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('holds one place in the tab order', () => {
    render(<Harness start="speakers" />);
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('opens the panel the selected tab names', () => {
    render(<Harness />);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('The running order.');
    expect(panel).toHaveAccessibleName('Programme');
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-controls', panel.id);
  });

  it('moves along the row with the arrow keys, and opens as it goes', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Who is talking.');
  });

  it('closes the ring, and reaches the ends with Home and End', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'End' });
    expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves focus with the selection', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
  });

  it('shows one panel at a time', () => {
    render(<Harness />);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('refuses to render a part outside its own set', () => {
    // A stray <Tab> would render a control that answers to nothing.
    expect(() => render(<Tab id="stray">Stray</Tab>)).toThrow(/inside <Tabs>/);
  });
});
