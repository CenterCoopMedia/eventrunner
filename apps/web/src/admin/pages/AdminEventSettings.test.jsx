// Event settings: the announce and archive dates (audit 07 #1, #6). Mocks
// adminApi directly, as AdminSpeakerMail.test.jsx does, and serves the
// stored config/event from a mocked EventConfigContext. The dates are the
// operator's (functions/src/admin/config.cjs refuses a staff change), so
// each role has its own cases.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AdminApiError } from '../adminApi.js';

const callMock = vi.fn();
vi.mock('../adminApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useAdminApi: () => callMock,
}));

const showToastMock = vi.fn();
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast: showToastMock }) }));

let tier = 'operator';
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ adminTier: tier }) }));

let eventConfig;
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig, sources: { event: 'live' } }),
}));

vi.mock('../adminSource.js', () => ({ subscribeAdminCollection: () => () => {} }));

import AdminEventSettings from './AdminEventSettings.jsx';

const ZONE = 'America/New_York';

function storedEvent(overrides = {}) {
  return {
    name: 'Example Summit',
    shortName: 'EX27',
    timezone: ZONE,
    days: [{ id: 'day-1', label: 'Thursday', date: '2027-05-13', startTime: '09:00', endTime: '17:00' }],
    registration: { opensAt: null, closesAt: null },
    sender: { email: 'summit@example.org', name: 'Example Summit', replyTo: null },
    announcedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function panel() {
  return screen.getByRole('heading', { name: 'Announce and archive' }).closest('section');
}

function dateTimeInputs(legend) {
  const group = within(panel()).getByRole('group', { name: legend });
  return {
    group,
    date: within(group).getByLabelText(/Date/),
    time: within(group).getByLabelText(/Time/),
  };
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save event settings' }));
}

function sentEvent() {
  const call = callMock.mock.calls.find(([name]) => name === 'updateEventConfig');
  return call?.[1].event;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-09T15:00:00Z'));
  tier = 'operator';
  eventConfig = storedEvent();
  callMock.mockReset();
  callMock.mockResolvedValue({ ok: true });
  showToastMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminEventSettings: announce and archive', () => {
  it('shows an operator two clearable date fields and the phase the site is in now', () => {
    render(<AdminEventSettings />);
    expect(within(panel()).getByText(/Phase now:/).closest('p').textContent).toBe('Phase now: Draft. The site is not announced yet.');
    const announced = dateTimeInputs('Announced');
    expect(within(announced.group).getByText(/Before this date the site is in draft/)).toBeTruthy();
    expect(within(announced.group).getByText('Not set. The site stays in draft.')).toBeTruthy();
    expect(dateTimeInputs('Archived').date).toBeTruthy();
    expect(within(panel()).queryByText(/Our team sets these dates/)).toBeNull();
  });

  it('sends an entered announce date as an event-local stamp, and an empty archive date as null', async () => {
    render(<AdminEventSettings />);
    const announced = dateTimeInputs('Announced');
    fireEvent.change(announced.date, { target: { value: '2026-11-01' } });
    fireEvent.change(announced.time, { target: { value: '09:30' } });
    save();
    await waitFor(() => expect(sentEvent()).toBeTruthy());
    expect(sentEvent().announcedAt).toBe('2026-11-01T09:30');
    expect(sentEvent().archivedAt).toBeNull();
    expect(await screen.findByText('Saved. The site picks the change up live.')).toBeTruthy();
  });

  it('shows the stored dates on the event clock, and Clear sends null', async () => {
    eventConfig = storedEvent({ announcedAt: '2026-10-01T09:00:00', archivedAt: '2026-11-01T00:00' });
    render(<AdminEventSettings />);
    expect(within(panel()).getByText(/Phase now:/).closest('p').textContent).toBe('Phase now: Archived.');
    const archived = dateTimeInputs('Archived');
    expect(archived.date.value).toBe('2026-11-01');
    expect(archived.time.value).toBe('00:00');
    expect(dateTimeInputs('Announced').date.value).toBe('2026-10-01');
    fireEvent.click(within(archived.group).getByRole('button', { name: 'Clear archived' }));
    save();
    await waitFor(() => expect(sentEvent()).toBeTruthy());
    // The announce date was not edited, so its stored bytes go back as they are.
    expect(sentEvent().announcedAt).toBe('2026-10-01T09:00:00');
    expect(sentEvent().archivedAt).toBeNull();
  });

  it('keeps the chosen one of a time the clocks pass twice, and sends the wall clock', async () => {
    render(<AdminEventSettings />);
    const announced = dateTimeInputs('Announced');
    fireEvent.change(announced.date, { target: { value: '2026-11-01' } });
    fireEvent.change(announced.time, { target: { value: '01:30' } });
    const later = within(announced.group).getByRole('radio', { name: /after the clocks go back/ });
    fireEvent.click(later);
    expect(later.checked).toBe(true);
    save();
    await waitFor(() => expect(sentEvent()).toBeTruthy());
    expect(sentEvent().announcedAt).toBe('2026-11-01T01:30');
    expect(later.checked).toBe(true);
  });

  it('refuses to save a date with no time, and moves focus to that field', async () => {
    render(<AdminEventSettings />);
    const announced = dateTimeInputs('Announced');
    fireEvent.change(announced.date, { target: { value: '2026-11-01' } });
    save();
    await vi.advanceTimersByTimeAsync(1);
    expect(callMock).not.toHaveBeenCalledWith('updateEventConfig', expect.anything());
    expect(within(announced.group).getByText('Enter a time.')).toBeTruthy();
    expect(document.activeElement).toBe(announced.time);
  });

  it('shows a server refusal under the field it names', async () => {
    callMock.mockRejectedValue(new AdminApiError({ code: 'bad-request', status: 400, message: 'Invalid event: archivedAt: needs an announce date' }));
    render(<AdminEventSettings />);
    const archived = dateTimeInputs('Archived');
    fireEvent.change(archived.date, { target: { value: '2026-12-01' } });
    fireEvent.change(archived.time, { target: { value: '00:00' } });
    save();
    await waitFor(() => expect(within(panel()).getAllByText(/needs an announce date/).length).toBe(1));
    expect(screen.getByRole('alert').textContent).toMatch(/needs an announce date/);
  });

  it('shows staff the dates as text and leaves them out of the save', async () => {
    tier = 'staff';
    eventConfig = storedEvent({ announcedAt: '2026-10-01T09:00' });
    render(<AdminEventSettings />);
    expect(within(panel()).queryByRole('group', { name: 'Announced' })).toBeNull();
    expect(within(panel()).getByText(/Thursday, October 1, 2026/)).toBeTruthy();
    expect(within(panel()).getByText('Not set.')).toBeTruthy();
    expect(within(panel()).getByText('Our team sets these dates. To change them, contact us.')).toBeTruthy();
    expect(within(panel()).getByText(/Phase now:/).closest('p').textContent).toBe('Phase now: Registration is open.');
    save();
    await waitFor(() => expect(sentEvent()).toBeTruthy());
    expect('announcedAt' in sentEvent()).toBe(false);
    expect('archivedAt' in sentEvent()).toBe(false);
    expect('sender' in sentEvent()).toBe(false);
  });
});
