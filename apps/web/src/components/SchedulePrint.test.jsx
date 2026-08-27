// The printed programme (design brief §2.1; visual stories, part 2).
//
// Two halves, and both are needed. What is IN the handout is markup, so it
// is rendered here; whether it is the only view on paper is a property of
// the stylesheet, so that half is asserted against index.css. jsdom applies
// no CSS, which is why one test cannot do both.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import SchedulePrint from './SchedulePrint.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', 'index.css'), 'utf8');

const EVENT = {
  timezone: 'America/Chicago',
  days: [
    { id: 'day-1', label: 'Day one', date: '2026-10-15', startTime: '09:00', endTime: '17:00' },
    { id: 'day-2', label: 'Day two', date: '2026-10-16', startTime: '09:00', endTime: '17:00' },
  ],
};
const COLUMNS = [
  { letter: 'A', name: 'Practice' },
  { letter: 'B', name: 'Sustainability' },
];
const SESSIONS = new Map([
  [
    'day-1',
    [
      {
        id: 'workshop',
        dayId: 'day-1',
        startTime: '10:30',
        endTime: '12:00',
        title: '[Fixture] Audience workshop',
        location: 'Room B',
        track: 'B',
        visible: true,
      },
      {
        id: 'clinic',
        dayId: 'day-1',
        startTime: '11:00',
        endTime: '12:00',
        title: '[Fixture] Survey clinic',
        location: 'Room B',
        track: 'B',
        parentId: 'workshop',
        visible: true,
      },
    ],
  ],
  [
    'day-2',
    [
      {
        id: 'plenary',
        dayId: 'day-2',
        startTime: '09:30',
        endTime: '10:15',
        title: '[Fixture] Closing plenary',
        location: 'Main hall',
        visible: true,
      },
    ],
  ],
]);

function renderPrint() {
  return render(
    <SchedulePrint
      days={EVENT.days}
      sessionsByDay={SESSIONS}
      columns={COLUMNS}
      eventConfig={EVENT}
    />,
  );
}

describe('the printed programme', () => {
  it('prints every day of the event, not the one on screen', () => {
    renderPrint();
    expect(screen.getByRole('heading', { name: /day one/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /day two/i })).toBeInTheDocument();
    expect(screen.getByText('[Fixture] Closing plenary')).toBeInTheDocument();
  });

  it('names every line by its letter and its name', () => {
    renderPrint();
    expect(screen.getByText(/B · Sustainability · Room B/)).toBeInTheDocument();
  });

  it('lists a calling point under its service, and says what it is part of', () => {
    const { container } = renderPrint();
    const calls = container.querySelector('.schedule-print__calls');
    expect(within(calls).getByText('[Fixture] Survey clinic', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/\(part of \[Fixture\] Audience workshop\)/)).toBeInTheDocument();
  });

  it('carries the times a reader needs, and no control at all', () => {
    const { container } = renderPrint();
    expect(container.querySelector('.schedule-print__time').textContent).toBe('10:30 AM–12:00 PM');
    expect(container.querySelectorAll('button, a, input')).toHaveLength(0);
  });

  it('says so where a day has nothing on it yet', () => {
    render(
      <SchedulePrint
        days={EVENT.days}
        sessionsByDay={new Map()}
        columns={COLUMNS}
        eventConfig={EVENT}
      />,
    );
    expect(screen.getAllByText(/no sessions are announced for this day/i)).toHaveLength(2);
  });
});

describe('the print stylesheet', () => {
  const printBlock = indexCss.slice(indexCss.indexOf('@media print'));

  it('keeps the handout out of the page, and out of the reading order', () => {
    // `display: none` outside print media is what stops a screen reader
    // meeting every session twice.
    expect(indexCss).toMatch(/\.schedule-print \{\n {2}display: none;\n\}/);
  });

  it('swaps the two views rather than hiding the controls of one', () => {
    expect(printBlock).toMatch(/\.schedule-screen \{\s*display: none;/);
    expect(printBlock).toMatch(/\.schedule-print \{\s*display: block;/);
  });

  it('prints no control', () => {
    expect(printBlock).toMatch(/\.no-print,\s*\n\s*nav,\s*\n\s*footer,\s*\n\s*\.skip-link \{/);
  });

  it('prints at full contrast', () => {
    // Support lines that sit in the secondary ink on screen print in the
    // primary one: paper has no backlight.
    expect(printBlock).toContain('color: rgb(var(--color-text-primary-rgb));');
    expect(printBlock).not.toContain('--color-text-secondary-rgb');
  });

  it('asks the active preset for its register, and never names a theme', () => {
    // Type roles and rule tokens only. A rule that named a preset would be
    // a second design rather than the same handout in six registers.
    expect(printBlock).toMatch(/font-family: var\(--font-heading\)/);
    expect(printBlock).toMatch(/font-family: var\(--font-data\)/);
    expect(printBlock).not.toMatch(/data-theme/);
  });

  it('never breaks an entry across two sheets', () => {
    expect(printBlock).toContain('break-inside: avoid;');
  });
});
