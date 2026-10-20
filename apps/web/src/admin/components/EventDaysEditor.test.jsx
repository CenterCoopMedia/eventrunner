// The event days (issue #475): one compact add control, a remove control
// inside each day that names that day, no id field, and a stated
// consequence before a day that sessions use is removed.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import EventDaysEditor, { daysPayload, nextDayId, normalizeDays } from './EventDaysEditor.jsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const STORED = [
  { id: 'day-1', label: 'Opening day', date: '2027-06-10', startTime: '09:00', endTime: '17:00' },
  { id: 'workshops', label: 'Workshops', date: '2027-06-11', startTime: '09:00', endTime: '16:00' },
];

function Harness({ stored = STORED, usage = new Map(), errors = new Map(), onDays = () => {} }) {
  const [days, setDays] = useState(() => normalizeDays(stored));
  return (
    <EventDaysEditor
      days={days}
      onChange={(next) => { setDays(next); onDays(next); }}
      errorFor={(field) => errors.get(field)}
      dayUsage={usage}
    />
  );
}

const flush = () => act(() => { vi.runAllTimers(); });

describe('nextDayId', () => {
  it('numbers a new day after the list and skips every id in use or still referenced', () => {
    expect(nextDayId([], new Set())).toBe('day-1');
    expect(nextDayId(normalizeDays(STORED), new Set())).toBe('day-3');
    expect(nextDayId(normalizeDays([{ id: 'day-3' }, { id: 'day-1' }]), new Set(['day-4']))).toBe('day-5');
  });
});

describe('EventDaysEditor', () => {
  it('keeps every day field and shows no id field', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Day 1 label')).toHaveValue('Opening day');
    expect(screen.getByLabelText('Day 1 date')).toHaveValue('2027-06-10');
    expect(screen.getByLabelText('Day 1 start')).toHaveValue('09:00');
    expect(screen.getByLabelText('Day 1 end')).toHaveValue('17:00');
    expect(screen.queryByLabelText(/id$/)).toBeNull();
    expect(screen.queryByText('day-1')).toBeNull();
  });

  it('adds a day with a new id from one labelled control and moves focus into it', () => {
    vi.useFakeTimers();
    const onDays = vi.fn();
    render(<Harness onDays={onDays} usage={new Map([['day-3', ['Orphaned talk']]])} />);
    const add = screen.getByRole('button', { name: 'Add day' });
    fireEvent.click(add);
    flush();
    // day-3 is still named by a session, so the new day does not take it.
    const days = onDays.mock.calls.at(-1)[0];
    expect(daysPayload(days).map((day) => day.id)).toEqual(['day-1', 'workshops', 'day-4']);
    expect(screen.getByLabelText('Day 3 label')).toHaveFocus();
    expect(screen.getAllByRole('button', { name: 'Add day' })).toHaveLength(1);
  });

  it('keeps the new day’s id through later edits, so a retried save sends the same id', () => {
    const onDays = vi.fn();
    render(<Harness onDays={onDays} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add day' }));
    fireEvent.change(screen.getByLabelText('Day 3 label'), { target: { value: 'Field trip' } });
    fireEvent.change(screen.getByLabelText('Day 3 date'), { target: { value: '2027-06-12' } });
    expect(daysPayload(onDays.mock.calls.at(-1)[0])).toEqual([
      STORED[0],
      STORED[1],
      { id: 'day-3', label: 'Field trip', date: '2027-06-12', startTime: '', endTime: '' },
    ]);
  });

  it('names the day on its own remove control, inside that day', () => {
    render(<Harness />);
    const second = screen.getByRole('listitem', { name: /Day 2/ });
    const remove = within(second).getByRole('button', { name: 'Remove day 2, Workshops' });
    expect(remove).toHaveTextContent('Remove');
    expect(screen.getAllByRole('button', { name: /^Remove day/ })).toHaveLength(2);
  });

  it('removes an unused day at once, says it goes on save, and keeps the other day’s id', () => {
    vi.useFakeTimers();
    const onDays = vi.fn();
    render(<Harness onDays={onDays} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove day 1, Opening day' }));
    flush();
    expect(daysPayload(onDays.mock.calls.at(-1)[0])).toEqual([STORED[1]]);
    expect(screen.getByRole('status')).toHaveTextContent('Opening day will be removed when you save.');
    // Focus lands on the remove control now in that place.
    expect(screen.getByRole('button', { name: 'Remove day 1, Workshops' })).toHaveFocus();
  });

  it('states what happens to the sessions before removing a day they use', () => {
    vi.useFakeTimers();
    const onDays = vi.fn();
    const usage = new Map([['workshops', ['Data desk', 'Audio lab', 'Video lab', 'Maps', 'Polls']]]);
    render(<Harness onDays={onDays} usage={usage} />);
    const second = screen.getByRole('listitem', { name: /Day 2/ });
    expect(within(second).getByText('Used by 5 sessions: Data desk, Audio lab, Video lab, Maps and 1 more.')).toBeInTheDocument();

    fireEvent.click(within(second).getByRole('button', { name: 'Remove day 2, Workshops' }));
    flush();
    expect(onDays).not.toHaveBeenCalled();
    const warning = within(second).getByRole('group', { name: 'Remove day 2?' });
    expect(warning).toHaveTextContent('5 sessions use this day. They stay saved, but they leave the public schedule until you give each one another day. Nothing changes until you save.');

    // Keeping the day changes nothing and returns focus to its control.
    fireEvent.click(within(warning).getByRole('button', { name: 'Keep day 2' }));
    flush();
    expect(onDays).not.toHaveBeenCalled();
    expect(within(second).getByRole('button', { name: 'Remove day 2, Workshops' })).toHaveFocus();

    fireEvent.click(within(second).getByRole('button', { name: 'Remove day 2, Workshops' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove day 2 anyway' }));
    flush();
    expect(daysPayload(onDays.mock.calls.at(-1)[0])).toEqual([STORED[0]]);
  });

  it('shows the server’s id error on the day it belongs to', () => {
    render(<Harness errors={new Map([['days[1].id', 'duplicate day id "workshops"']])} />);
    const second = screen.getByRole('listitem', { name: /Day 2/ });
    expect(within(second).getByText('Day 2: duplicate day id "workshops"')).toBeInTheDocument();
  });

  it('says plainly when there are no days', () => {
    render(<Harness stored={[]} />);
    expect(screen.getByText('No days configured yet.')).toBeInTheDocument();
  });

  it('copes with many days and a long label', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `day-${index + 1}`,
      label: index === 0 ? 'A very long day label that keeps going well past the width of a phone screen' : '',
      date: `2027-06-${String(index + 10).padStart(2, '0')}`,
      startTime: '09:00',
      endTime: '17:00',
    }));
    render(<Harness stored={many} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    // A day without a label is named by its date.
    expect(screen.getByRole('button', { name: 'Remove day 12, June 21, 2027' })).toBeInTheDocument();
  });
});
