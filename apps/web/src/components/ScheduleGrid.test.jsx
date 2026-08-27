// The schedule grid as a reader meets it (design brief §2.1, §2.2, §8.1).
//
// Two things are under test here, and they are the two things the brief
// binds: the table has real header semantics, and the column interaction
// has a keyboard path with a stated state. The look of the interaction is a
// property of the stylesheet, so it is asserted in scheduleSignature.test.js
// instead — jsdom applies no CSS.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({ speakers: [] }),
}));

const { default: ScheduleGrid } = await import('./ScheduleGrid.jsx');
const { withCallingPoints } = await import('../lib/scheduleGrid.js');

const EVENT = {
  timezone: 'America/New_York',
  days: [{ id: 'day-1', label: 'Day one', date: '2026-10-14' }],
};
const DAY = EVENT.days[0];
const COLUMNS = [
  { letter: 'A', name: 'Practice' },
  { letter: 'B', name: 'Sustainability' },
];

const SESSIONS = [
  {
    id: 'plenary',
    dayId: 'day-1',
    startTime: '09:00',
    endTime: '09:45',
    title: '[Fixture] Opening plenary',
    location: 'Main hall',
    visible: true,
  },
  {
    id: 'practice',
    dayId: 'day-1',
    startTime: '10:30',
    endTime: '12:00',
    title: '[Fixture] Reporting workshop',
    location: 'Room A',
    track: 'A',
    visible: true,
  },
  {
    id: 'money',
    dayId: 'day-1',
    startTime: '10:30',
    endTime: '12:00',
    title: '[Fixture] Budget workshop',
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
    parentId: 'money',
    visible: true,
  },
];

function renderGrid(sessions = SESSIONS, columns = COLUMNS) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScheduleGrid
        day={DAY}
        entries={withCallingPoints(sessions)}
        columns={columns}
        eventConfig={EVENT}
      />
    </MemoryRouter>,
  );
}

describe('the schedule grid', () => {
  it('is a table with a name, column headers, and row headers', () => {
    renderGrid();
    const table = screen.getByRole('table', { name: /day one, sessions by track/i });
    expect(table).toBeInTheDocument();
    // The lines are column headers, in the order the client listed them.
    const heads = within(table).getAllByRole('columnheader');
    expect(heads.map((th) => th.dataset.track)).toEqual([undefined, 'A', 'B']);
    // The times are row headers, so a cell is announced with its time.
    const rowHeads = within(table).getAllByRole('rowheader');
    expect(rowHeads.map((th) => th.textContent)).toEqual(['9:00 AM', '10:30 AM']);
  });

  it('runs a session with no line across the whole row', () => {
    const { container } = renderGrid();
    const plenaryCell = container.querySelector('td[colspan]');
    expect(plenaryCell).toHaveAttribute('colspan', '2');
    expect(within(plenaryCell).getByRole('link', { name: /opening plenary/i })).toBeInTheDocument();
  });

  it('puts each session in its own line’s column', () => {
    const { container } = renderGrid();
    const cellA = container.querySelector('td[data-track="A"]');
    const cellB = container.querySelector('td[data-track="B"]');
    expect(within(cellA).getByRole('link', { name: /reporting workshop/i })).toBeInTheDocument();
    expect(within(cellB).getByRole('link', { name: /budget workshop/i })).toBeInTheDocument();
  });

  it('lists a child under its parent, in its parent’s cell, never as a row', () => {
    const { container } = renderGrid();
    const cellB = container.querySelector('td[data-track="B"]');
    const points = within(cellB).getByRole('list', {
      name: /calling points of \[fixture\] budget workshop/i,
    });
    expect(within(points).getByRole('link', { name: /survey clinic/i })).toBeInTheDocument();
    // 11:00 is the child's time, and a child gets no row of its own.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('states the relationship in words, not by the indent alone', () => {
    renderGrid();
    expect(screen.getByText(/part of \[fixture\] budget workshop/i)).toBeInTheDocument();
  });

  it('opens the calling points, and lets a reader close them', () => {
    renderGrid();
    const toggle = screen.getByRole('button', { name: '1 calling point' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /survey clinic/i })).not.toBeInTheDocument();
  });
});

describe('the column that comes forward', () => {
  it('gives every line a head that is a real control, named by its line', () => {
    renderGrid();
    for (const name of ['Practice', 'Sustainability']) {
      const head = screen.getByRole('button', { name });
      expect(head).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('brings a column forward on a press, and states that it is pressed', () => {
    const { container } = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(screen.getByRole('button', { name: 'Practice' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(container.querySelector('.schedule-grid').dataset.forward).toBe('A');
    // Every cell of that column carries the state, and no other cell does.
    const forward = [...container.querySelectorAll('[data-track-forward]')];
    expect(forward.length).toBeGreaterThan(0);
    expect(forward.every((el) => el.dataset.track === 'A')).toBe(true);
  });

  it('lets the same press take it back', () => {
    const { container } = renderGrid();
    const head = screen.getByRole('button', { name: 'Practice' });
    fireEvent.click(head);
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('.schedule-grid').dataset.forward).toBeUndefined();
  });

  it('previews a column as the keyboard reaches it, and lets go on the way out', () => {
    const { container } = renderGrid();
    const grid = container.querySelector('.schedule-grid');
    fireEvent.focus(screen.getByRole('button', { name: 'Sustainability' }));
    expect(grid.dataset.forward).toBe('B');
    // Focus is a preview, not a choice: the button is not pressed.
    expect(screen.getByRole('button', { name: 'Sustainability' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.blur(screen.getByRole('button', { name: 'Sustainability' }));
    expect(grid.dataset.forward).toBeUndefined();
  });

  it('keeps a pressed column forward after focus moves on', () => {
    const { container } = renderGrid();
    const grid = container.querySelector('.schedule-grid');
    const head = screen.getByRole('button', { name: 'Practice' });
    fireEvent.focus(head);
    fireEvent.click(head);
    fireEvent.blur(head);
    expect(grid.dataset.forward).toBe('A');
    expect(head).toHaveAttribute('aria-pressed', 'true');
  });
});
