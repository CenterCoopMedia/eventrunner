// The call deadline on the event's clock (issue #476). Staff set, read,
// change and clear the deadline as a date and a time; the stored value stays
// the RFC3339 instant updatePitchCall already takes. A save shows its result
// even though the saved values arrive back through the live snapshot.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

let pitchCall;
let pushCall;
let operator = true;
const call = vi.fn();
vi.mock('../../lib/pitchSource.js', () => ({
  subscribePitchCall: (onNext) => { pushCall = onNext; onNext(pitchCall); return () => {}; },
}));
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (_name, onNext) => { onNext([]); return () => {}; },
}));
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ isOperator: operator }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: { days: [], timezone: 'America/New_York' } }) }));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));

import AdminSessionPitches from './AdminSessionPitches.jsx';

const STORED = '2027-02-01T04:59:59.000Z';
const dateField = () => screen.getByLabelText('Deadline Date');
const timeField = () => screen.getByLabelText('Deadline Time');
const saveButton = () => screen.getByRole('button', { name: 'Save call settings' });

function open() {
  const view = render(<MemoryRouter><AdminSessionPitches /></MemoryRouter>);
  fireEvent.click(screen.getByText('Manage the call for sessions'));
  return view;
}

beforeEach(() => {
  operator = true;
  call.mockReset();
  call.mockImplementation(async (_name, body) => ({ ...body, closesAt: new Date(body.closesAt).toISOString() }));
  pitchCall = { enabled: true, closesAt: STORED, externalFormUrl: null };
});
afterEach(cleanup);

describe('AdminSessionPitches deadline', () => {
  it('reads the saved deadline back on the event’s clock, never as a raw timestamp', () => {
    const { container } = open();
    expect(dateField()).toHaveValue('2027-01-31');
    expect(timeField()).toHaveValue('23:59:59');
    expect(screen.getByText('Event time zone: Eastern Time (America/New_York).')).toBeInTheDocument();
    expect(screen.getByText('Intake closes Sunday, January 31, 2027 at 11:59:59 PM Eastern Standard Time (UTC−05:00).')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/RFC3339|2027-02-01T04:59:59/);
  });

  it('saves a new deadline as the stored RFC3339 instant', async () => {
    open();
    fireEvent.change(dateField(), { target: { value: '2027-01-15' } });
    fireEvent.change(timeField(), { target: { value: '23:59' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: true, closesAt: '2027-01-16T04:59:00.000Z', externalFormUrl: null }));
  });

  it('keeps the stored deadline as it was when only another setting changes', async () => {
    open();
    fireEvent.click(screen.getByLabelText('Accept session pitches'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: false, closesAt: STORED, externalFormUrl: null }));
  });

  it('refuses a cleared deadline before calling the server and moves focus to it', async () => {
    open();
    fireEvent.change(dateField(), { target: { value: '' } });
    fireEvent.change(timeField(), { target: { value: '' } });
    expect(screen.getByText('No deadline is set. Enter one, or choose “Open until I close it”.')).toBeInTheDocument();
    fireEvent.click(saveButton());
    expect(call).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a date and a time.')).toBeInTheDocument();
    await waitFor(() => expect(dateField()).toHaveFocus());
    expect(dateField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('marks a missing deadline and a bad form address in one refused save', async () => {
    open();
    fireEvent.change(timeField(), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Where people pitch'), { target: { value: 'external' } });
    fireEvent.change(screen.getByLabelText('External form address'), { target: { value: 'http://forms.example.org/a' } });
    fireEvent.click(saveButton());
    expect(call).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a time.')).toBeInTheDocument();
    expect(screen.getByText('Use an address that starts with https://.')).toBeInTheDocument();
    await waitFor(() => expect(timeField()).toHaveFocus());
  });

  it('refuses a deadline the clocks skip and saves nothing', async () => {
    open();
    fireEvent.change(dateField(), { target: { value: '2027-03-14' } });
    fireEvent.change(timeField(), { target: { value: '02:30' } });
    expect(screen.getByText(/2:30 AM does not exist on March 14, 2027/)).toBeInTheDocument();
    fireEvent.click(saveButton());
    expect(call).not.toHaveBeenCalled();
    await waitFor(() => expect(timeField()).toHaveFocus());
  });

  it('asks which repeated time is meant before it saves', async () => {
    open();
    fireEvent.change(dateField(), { target: { value: '2027-11-07' } });
    fireEvent.change(timeField(), { target: { value: '01:30' } });
    fireEvent.click(saveButton());
    expect(call).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('radio', { name: /EDT/ })).toHaveFocus());
    fireEvent.click(screen.getByRole('radio', { name: /EST/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: true, closesAt: '2027-11-07T06:30:00.000Z', externalFormUrl: null }));
  });

  it('shows "Call settings saved." after the saved values come back through the snapshot', async () => {
    open();
    const button = saveButton();
    fireEvent.change(timeField(), { target: { value: '22:00' } });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(call).toHaveBeenCalled());
    const saved = { enabled: true, closesAt: '2027-02-01T03:00:00.000Z', externalFormUrl: null };
    act(() => pushCall(saved));
    expect(await screen.findByText('Call settings saved.')).toBeInTheDocument();
    // The same panel, not a remount: the button the person pressed keeps focus.
    expect(saveButton()).toBe(button);
    expect(button).toHaveFocus();
    expect(timeField()).toHaveValue('22:00');
  });

  it('keeps the message when the snapshot lands before the save response', async () => {
    let resolve;
    call.mockImplementation(() => new Promise((done) => { resolve = done; }));
    open();
    fireEvent.change(timeField(), { target: { value: '22:00' } });
    fireEvent.click(saveButton());
    // The button keeps focus while the save runs: it says it is busy instead of going disabled.
    const busyButton = screen.getByRole('button', { name: 'Saving…' });
    expect(busyButton).not.toBeDisabled();
    expect(busyButton).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(busyButton);
    expect(call).toHaveBeenCalledTimes(1);
    const saved = { enabled: true, closesAt: '2027-02-01T03:00:00.000Z', externalFormUrl: null };
    act(() => pushCall(saved));
    await act(async () => resolve(saved));
    expect(await screen.findByText('Call settings saved.')).toBeInTheDocument();
    expect(screen.queryByText(/The saved call settings changed/)).toBeNull();
  });

  it('keeps unsaved edits after a failed save', async () => {
    call.mockRejectedValue(Object.assign(new Error('The session pitch call could not be saved.'), {}));
    open();
    fireEvent.change(dateField(), { target: { value: '2027-01-20' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText('The session pitch call could not be saved.')).toBeInTheDocument();
    expect(dateField()).toHaveValue('2027-01-20');
    expect(timeField()).toHaveValue('23:59:59');
  });

  it('takes a change saved elsewhere in place, and keeps unsaved edits when there are some', () => {
    open();
    act(() => pushCall({ enabled: true, closesAt: '2027-03-01T17:00:00.000Z', externalFormUrl: null }));
    expect(dateField()).toHaveValue('2027-03-01');
    expect(timeField()).toHaveValue('12:00');
    fireEvent.change(timeField(), { target: { value: '18:00' } });
    act(() => pushCall({ enabled: false, closesAt: '2027-03-01T17:00:00.000Z', externalFormUrl: null }));
    expect(screen.getByText(/The saved call settings changed. Your unsaved edits are still here./)).toBeInTheDocument();
    expect(timeField()).toHaveValue('18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Load saved settings' }));
    expect(timeField()).toHaveValue('12:00');
    expect(screen.getByLabelText('Accept session pitches')).not.toBeChecked();
  });

  it('reads a saved call with no deadline as "Open until I close it"', () => {
    pitchCall = { enabled: true, closesAt: null, externalFormUrl: null };
    open();
    expect(screen.getByRole('radio', { name: 'Open until I close it' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'At a set date and time' })).not.toBeChecked();
    expect(screen.queryByLabelText('Deadline Date')).toBeNull();
    expect(screen.getByText('Intake stays open until an operator clears “Accept session pitches” and saves. The public page shows no deadline.')).toBeInTheDocument();
  });

  it('saves "Open until I close it" as a null deadline without asking for a date', async () => {
    call.mockImplementation(async (_name, body) => body);
    open();
    fireEvent.change(dateField(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Open until I close it' }));
    expect(screen.queryByLabelText('Deadline Date')).toBeNull();
    fireEvent.click(saveButton());
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: true, closesAt: null, externalFormUrl: null }));
    expect(await screen.findByText('Call settings saved.')).toBeInTheDocument();
  });

  it('keeps the no-deadline choice with an external form', async () => {
    call.mockImplementation(async (_name, body) => body);
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Open until I close it' }));
    fireEvent.change(screen.getByLabelText('Where people pitch'), { target: { value: 'external' } });
    fireEvent.change(screen.getByLabelText('External form address'), { target: { value: 'https://airtable.com/appExample/shrExample' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: true, closesAt: null, externalFormUrl: 'https://airtable.com/appExample/shrExample' }));
  });

  it('closes a no-deadline call by hand: clear "Accept session pitches" and save', async () => {
    call.mockImplementation(async (_name, body) => body);
    pitchCall = { enabled: true, closesAt: null, externalFormUrl: null };
    open();
    fireEvent.click(screen.getByLabelText('Accept session pitches'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: false, closesAt: null, externalFormUrl: null }));
  });

  it('brings the earlier date back when staff return to a set deadline', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Open until I close it' }));
    fireEvent.click(screen.getByRole('radio', { name: 'At a set date and time' }));
    expect(dateField()).toHaveValue('2027-01-31');
    expect(timeField()).toHaveValue('23:59:59');
    fireEvent.click(saveButton());
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: true, closesAt: STORED, externalFormUrl: null }));
  });

  it('asks for a date when staff move a no-deadline call to a set deadline', async () => {
    pitchCall = { enabled: true, closesAt: null, externalFormUrl: null };
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'At a set date and time' }));
    fireEvent.click(saveButton());
    expect(call).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a date and a time.')).toBeInTheDocument();
    await waitFor(() => expect(dateField()).toHaveFocus());
  });

  it('takes a no-deadline call saved elsewhere in place', () => {
    open();
    act(() => pushCall({ enabled: true, closesAt: null, externalFormUrl: null }));
    expect(screen.getByRole('radio', { name: 'Open until I close it' })).toBeChecked();
    expect(screen.queryByText(/The saved call settings changed/)).toBeNull();
  });

  it('shows the call settings to operators only', () => {
    operator = false;
    render(<MemoryRouter><AdminSessionPitches /></MemoryRouter>);
    expect(screen.queryByText('Manage the call for sessions')).toBeNull();
  });

  it('aligns the filter and search fields on their inputs at wide widths', () => {
    render(<MemoryRouter><AdminSessionPitches /></MemoryRouter>);
    const row = screen.getByLabelText('Filter by decision').closest('.grid');
    expect(row).toContainElement(screen.getByLabelText('Search pitches'));
    expect(row.className).toMatch(/\bsm:items-end\b/);
  });
});
