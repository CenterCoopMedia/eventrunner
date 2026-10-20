// The event's time zone (issue #475): a searchable list of places with the
// zone's usual name and offset, on the WAI-ARIA combobox pattern. The value
// saved is the IANA name; staff never type it.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import TimeZoneField from './TimeZoneField.jsx';

afterEach(cleanup);

const JULY = new Date('2027-07-01T12:00:00Z');

function Harness({ initial = 'America/New_York', onValue = () => {}, error, days = [] }) {
  const [value, setValue] = useState(initial);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <TimeZoneField
        value={value}
        onChange={(next) => { setValue(next); onValue(next); }}
        error={error}
        days={days}
        now={JULY}
      />
      <button type="submit">Save</button>
    </form>
  );
}

const field = () => screen.getByRole('combobox', { name: 'Time zone' });
const key = (name, extra = {}) => fireEvent.keyDown(field(), { key: name, ...extra });

describe('TimeZoneField', () => {
  it('shows the stored zone in words and keeps the IANA name out of the field', () => {
    render(<Harness />);
    expect(field()).toHaveValue('New York (Eastern Time, UTC−04:00)');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveAttribute('aria-autocomplete', 'list');
    expect(screen.queryByRole('listbox')).toBeNull();
    // The stored name is stated once, quietly, under the field.
    expect(screen.getByText(/Saved as America\/New_York\./)).toBeInTheDocument();
  });

  it('selects the saved zone’s words on focus, so typing starts a new search', () => {
    render(<Harness />);
    field().focus();
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(field().value.length);
  });

  it('filters as staff type, and Enter chooses the first match without sending the form', () => {
    const onValue = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(<Harness onValue={onValue} />);
    field().closest('form').addEventListener('submit', onSubmit);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'chicago' } });
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('listbox', { name: 'Time zone' });
    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Chicago');
    expect(options[0]).toHaveTextContent('Central Time');
    expect(options[0]).toHaveTextContent('UTC−05:00');
    expect(field()).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/time zones? match/)).toBeInTheDocument();

    key('Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onValue).toHaveBeenLastCalledWith('America/Chicago');
    expect(field()).toHaveValue('Chicago (Central Time, UTC−05:00)');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).not.toHaveAttribute('aria-activedescendant');
  });

  it('opens on Down, moves with the arrows, and marks the saved zone with a word', () => {
    render(<Harness />);
    fireEvent.focus(field());
    key('ArrowDown');
    const list = screen.getByRole('listbox');
    const active = () => document.getElementById(field().getAttribute('aria-activedescendant'));
    // The list opens on the saved zone.
    expect(active()).toHaveTextContent('New York');
    expect(active()).toHaveTextContent('Current');
    key('ArrowDown');
    expect(active()).not.toHaveTextContent('Current');
    key('ArrowUp');
    expect(active()).toHaveTextContent('New York');
    // Only the saved zone carries the word; state is never colour alone.
    expect(within(list).getAllByText('Current')).toHaveLength(1);
  });

  it('closes on Escape and puts the saved zone back, changing nothing', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'tok' } });
    key('Escape');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveValue('New York (Eastern Time, UTC−04:00)');
    expect(onValue).not.toHaveBeenCalled();
  });

  it('leaving the field without choosing keeps the saved zone', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'paris' } });
    fireEvent.blur(field());
    expect(field()).toHaveValue('New York (Eastern Time, UTC−04:00)');
    expect(onValue).not.toHaveBeenCalled();
  });

  it('chooses a zone with the pointer', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'kolkata' } });
    fireEvent.click(screen.getByRole('option', { name: /Kolkata/ }));
    expect(onValue).toHaveBeenLastCalledWith('Asia/Kolkata');
    expect(field()).toHaveValue('Kolkata (India Standard Time, UTC+05:30)');
  });

  it('says so when nothing matches', () => {
    render(<Harness />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'atlantis' } });
    expect(screen.getByText('No time zone matches “atlantis”. Try a city or a UTC offset.')).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
  });

  it('states the offset on the event days, including a clock change during the event', () => {
    render(<Harness days={[
      { date: '2027-11-06', startTime: '09:00' },
      { date: '2027-11-07', startTime: '09:00' },
    ]} />);
    expect(screen.getByText('The offset changes during the event: UTC−04:00 on November 6, 2027, then UTC−05:00 from November 7, 2027.')).toBeInTheDocument();
  });

  it('keeps an unknown stored value visible and asks for a choice', () => {
    render(<Harness initial="Mars/Olympus" />);
    expect(field()).toHaveValue('Mars/Olympus');
    expect(screen.getByText('Mars/Olympus is not a time zone this browser knows. Choose one from the list.')).toBeInTheDocument();
  });

  it('marks the field and names the error when the server refuses the zone', () => {
    render(<Harness error="timezone: must be a valid IANA timezone" />);
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(field()).toHaveAccessibleDescription(expect.stringContaining('must be a valid IANA timezone'));
  });
});
