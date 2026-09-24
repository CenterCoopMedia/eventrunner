// The tab pattern: the roving tab index, the arrow keys, and the panel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tab, TabList, TabPanel, Tabs } from './Tabs.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');

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

  // An unavailable tab (expansion record §2.1): aria-disabled, focusable so
  // it can explain itself, and every activation path refused.
  function DisabledHarness() {
    const [open, setOpen] = useState('programme');
    return (
      <Tabs value={open} onChange={setOpen} tabs={IDS}>
        <TabList label="Event pages">
          <Tab id="programme">Programme</Tab>
          <Tab id="speakers" disabled hint="Opens after the session">
            Speakers
          </Tab>
          <Tab id="venue">Venue</Tab>
        </TabList>
        <TabPanel id="programme">The running order.</TabPanel>
        <TabPanel id="speakers">Who is talking.</TabPanel>
        <TabPanel id="venue">Where to go.</TabPanel>
        <button type="button">Outside the row</button>
      </Tabs>
    );
  }

  it('moves the one tab stop with focus, and hands it back to the open tab when focus leaves', () => {
    render(<DisabledHarness />);
    const tabs = screen.getAllByRole('tab');
    const stops = () => tabs.map((tab) => tab.tabIndex);
    expect(stops()).toEqual([0, -1, -1]);
    tabs[0].focus();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    // The unavailable tab holds focus without being open, and it is the
    // stop now: Tab or Shift+Tab from here leaves the row rather than
    // landing back on the open tab inside it.
    expect(tabs[1]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(stops()).toEqual([-1, 0, -1]);
    // Focus leaves the row: the stop returns to the open tab.
    const outside = screen.getByRole('button', { name: 'Outside the row' });
    fireEvent.blur(tabs[1], { relatedTarget: outside });
    expect(stops()).toEqual([0, -1, -1]);
  });

  it('shows the reason for an unavailable tab under the row while it has focus or the pointer', () => {
    render(<DisabledHarness />);
    const tabs = screen.getAllByRole('tab');
    const shown = () => document.querySelector('.tab-list__reason');
    expect(shown()).toBeNull();
    tabs[0].focus();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(shown()).toHaveTextContent('Opens after the session');
    // The line is for a sighted reader: the name already carries the words.
    expect(shown()).toHaveAttribute('aria-hidden', 'true');
    fireEvent.blur(tabs[1], { relatedTarget: screen.getByRole('button', { name: 'Outside the row' }) });
    expect(shown()).toBeNull();
    fireEvent.mouseOver(tabs[1]);
    expect(shown()).toHaveTextContent('Opens after the session');
    fireEvent.mouseOver(tabs[2]);
    expect(shown()).toBeNull();
    fireEvent.mouseOver(tabs[1]);
    fireEvent.mouseLeave(screen.getByRole('tablist'));
    expect(shown()).toBeNull();
  });

  it('draws an unavailable tab with a dashed rule, not the ground tint alone', () => {
    // jsdom applies no CSS, so the rule is asserted against the stylesheet.
    const rule = indexCss.match(/\.tab\[aria-disabled='true'\] \{[^}]*\}/u)?.[0] ?? '';
    expect(rule).toContain('border-block-end-style: dashed');
  });

  it('marks an unavailable tab with aria-disabled and reads its reason in its name', () => {
    render(<DisabledHarness />);
    const tab = screen.getByRole('tab', { name: /Speakers/u });
    expect(tab).toHaveAttribute('aria-disabled', 'true');
    expect(tab).not.toBeDisabled();
    expect(tab).toHaveAccessibleName('Speakers (Opens after the session)');
  });

  it('refuses every activation path on an unavailable tab', () => {
    render(<DisabledHarness />);
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('The running order.');
    // The arrow key lands on it, so the reader hears why, and opens nothing.
    tabs[0].focus();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    // The next arrow moves on from where the reader is, and that one opens.
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(tabs[2]).toHaveFocus();
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Where to go.');
  });

  it('refuses to render a part outside its own set', () => {
    // A stray <Tab> would render a control that answers to nothing.
    expect(() => render(<Tab id="stray">Stray</Tab>)).toThrow(/inside <Tabs>/);
  });
});
