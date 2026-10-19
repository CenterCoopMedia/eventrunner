// The event-time control (issue #476): an ordinary date and time on the
// event's clock, read back in words with the zone and the offset for the
// chosen date, and never shifted across a clock change on its own.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import EventDateTimeField from './EventDateTimeField.jsx';

afterEach(cleanup);

function Harness({ initial = null, timeZone = 'America/New_York', required = false, showError = false, onValue = () => {}, onProblem = () => {}, clearable = false }) {
  const [value, setValue] = useState(initial);
  return <EventDateTimeField label="Pitch deadline" value={value} timeZone={timeZone} required={required} showError={showError} clearable={clearable} summaryPrefix="Closes" emptySummary="No deadline."
    onChange={(next) => { setValue(next); onValue(next); }} onProblemChange={onProblem} />;
}

const dateField = () => screen.getByLabelText('Pitch deadline Date');
const timeField = () => screen.getByLabelText('Pitch deadline Time');

describe('EventDateTimeField', () => {
  it('names each input with the legend and reads a stored instant back on the event’s clock', () => {
    render(<Harness initial="2027-02-01T04:59:59.000Z" />);
    expect(screen.getByRole('group', { name: 'Pitch deadline' })).toBeInTheDocument();
    expect(dateField()).toHaveValue('2027-01-31');
    expect(timeField()).toHaveValue('23:59:59');
    expect(screen.getByText('Event time zone: Eastern Time (America/New_York).')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Closes Sunday, January 31, 2027 at 11:59:59 PM Eastern Standard Time (UTC−05:00).');
    expect(screen.queryByText(/2027-02-01T04:59:59/)).toBeNull();
  });

  it('describes the summary with the offset of the selected date, not today’s', () => {
    const onValue = vi.fn();
    render(<Harness initial="2027-02-01T04:59:59.000Z" onValue={onValue} />);
    fireEvent.change(dateField(), { target: { value: '2027-07-01' } });
    fireEvent.change(timeField(), { target: { value: '09:00' } });
    expect(onValue).toHaveBeenLastCalledWith('2027-07-01T13:00:00.000Z');
    expect(screen.getByRole('status')).toHaveTextContent('Closes Thursday, July 1, 2027 at 9:00 AM Eastern Daylight Time (UTC−04:00).');
  });

  it('keeps a keyboard path: native inputs in reading order, none taken out of the tab order', () => {
    const onValue = vi.fn();
    render(<Harness initial="2027-01-16T04:59:00.000Z" clearable onValue={onValue} />);
    const group = screen.getByRole('group', { name: 'Pitch deadline' });
    const focusable = [...group.querySelectorAll('input, button, select, textarea, [tabindex]')];
    expect(focusable).toEqual([dateField(), timeField(), screen.getByRole('button', { name: 'Clear pitch deadline' })]);
    expect(focusable.every((element) => element.tabIndex >= 0)).toBe(true);
    dateField().focus();
    expect(dateField()).toHaveFocus();
    // jsdom has no segmented date and time entry, so each value arrives as one change.
    fireEvent.change(dateField(), { target: { value: '2027-01-15' } });
    fireEvent.change(timeField(), { target: { value: '23:58' } });
    expect(onValue).toHaveBeenLastCalledWith('2027-01-16T04:58:00.000Z');
  });

  it('refuses a time the clocks skip, at once, and saves nothing', () => {
    const onValue = vi.fn();
    const onProblem = vi.fn();
    render(<Harness onValue={onValue} onProblem={onProblem} />);
    fireEvent.change(dateField(), { target: { value: '2027-03-14' } });
    fireEvent.change(timeField(), { target: { value: '02:30' } });
    expect(onValue).toHaveBeenLastCalledWith(null);
    const message = '2:30 AM does not exist on March 14, 2027. The clocks move forward one hour that night. Choose an earlier or later time.';
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(onProblem).toHaveBeenLastCalledWith(message);
    expect(timeField()).toHaveAttribute('aria-invalid', 'true');
    expect(timeField().getAttribute('aria-describedby')).toContain(screen.getByText(message).id);
    fireEvent.change(timeField(), { target: { value: '03:30' } });
    expect(onValue).toHaveBeenLastCalledWith('2027-03-14T07:30:00.000Z');
    expect(onProblem).toHaveBeenLastCalledWith(null);
  });

  it('asks which of two repeated times is meant, and saves only the one chosen', () => {
    const onValue = vi.fn();
    const onProblem = vi.fn();
    render(<Harness onValue={onValue} onProblem={onProblem} />);
    fireEvent.change(dateField(), { target: { value: '2027-11-07' } });
    fireEvent.change(timeField(), { target: { value: '01:30' } });
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(onProblem).toHaveBeenLastCalledWith('1:30 AM happens twice on November 7, 2027. Choose which one you mean.');
    const group = screen.getByRole('group', { name: '1:30 AM happens twice on November 7, 2027' });
    const second = within(group).getByRole('radio', { name: '1:30 AM EST (UTC−05:00), after the clocks go back' });
    expect(within(group).getByRole('radio', { name: '1:30 AM EDT (UTC−04:00), before the clocks go back' })).not.toBeChecked();
    fireEvent.click(second);
    expect(onValue).toHaveBeenLastCalledWith('2027-11-07T06:30:00.000Z');
    expect(onProblem).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('status')).toHaveTextContent('Closes Sunday, November 7, 2027 at 1:30 AM Eastern Standard Time (UTC−05:00).');
  });

  it('opens a stored repeated time on the choice it already made', () => {
    render(<Harness initial="2027-11-07T05:30:00.000Z" />);
    expect(screen.getByRole('radio', { name: /EDT/ })).toBeChecked();
  });

  it('states a missing part only after a refused save, and marks the field', () => {
    const onProblem = vi.fn();
    const { rerender } = render(<Harness required onProblem={onProblem} />);
    expect(onProblem).toHaveBeenLastCalledWith('Enter a date and a time.');
    expect(screen.queryByText('Enter a date and a time.')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('No deadline.');
    rerender(<Harness required showError onProblem={onProblem} />);
    expect(screen.getByText('Enter a date and a time.')).toBeInTheDocument();
    expect(dateField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears to no value when the field is optional', () => {
    const onValue = vi.fn();
    const onProblem = vi.fn();
    render(<Harness initial="2027-01-16T04:59:00.000Z" clearable onValue={onValue} onProblem={onProblem} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear pitch deadline' }));
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(onProblem).toHaveBeenLastCalledWith(null);
    expect(dateField()).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('No deadline.');
  });

  it('works in a zone 30 minutes off the hour', () => {
    const onValue = vi.fn();
    render(<Harness timeZone="Asia/Kolkata" onValue={onValue} />);
    fireEvent.change(dateField(), { target: { value: '2027-01-15' } });
    fireEvent.change(timeField(), { target: { value: '23:59' } });
    expect(onValue).toHaveBeenLastCalledWith('2027-01-15T18:29:00.000Z');
    expect(screen.getByRole('status')).toHaveTextContent('India Standard Time (UTC+05:30)');
  });

  it('says so when the event has no usable time zone', () => {
    render(<Harness timeZone="" initial="2027-01-16T04:59:00.000Z" />);
    expect(screen.getByText(/The event has no time zone set, so this time is in UTC/)).toBeInTheDocument();
    expect(timeField()).toHaveValue('04:59');
  });

  it('takes a new stored value from outside, and keeps its own edits otherwise', () => {
    const { rerender } = render(<EventDateTimeField label="Pitch deadline" value="2027-01-16T04:59:00.000Z" timeZone="America/New_York" onChange={() => {}} />);
    rerender(<EventDateTimeField label="Pitch deadline" value="2027-03-01T17:00:00.000Z" timeZone="America/New_York" onChange={() => {}} />);
    expect(dateField()).toHaveValue('2027-03-01');
    expect(timeField()).toHaveValue('12:00');
  });
});
