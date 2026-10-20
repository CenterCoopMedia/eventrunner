// The scheduled reminders page (functions/src/reminders/schedules.cjs).
// Mocks adminApi directly, as AdminSpeakerReminders.test.jsx does: the
// endpoint is the only data source, and every message is rendered on the
// server.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));

import AdminReminderSchedules from './AdminReminderSchedules.jsx';
import { lastRunWords, nextRunWords, readOffsetInputs, stateWords } from '../reminderSchedules.js';

const ZONE = 'America/New_York';

function state(overrides = {}) {
  return {
    schedule: 'speakers',
    state: 'off',
    settings: { offsetsDays: [14, 7, 2], sendTime: '10:00', dueAt: '2026-11-20T22:00:00.000Z', topics: ['bio', 'headshot', 'description', 'materials'] },
    approval: { wordingVersion: null, at: null, by: null },
    paused: null,
    wording: { version: 'shipped:abc', matchesApproval: false },
    timeZone: ZONE,
    eventEnded: false,
    defaults: { offsetsDays: [14, 7, 2], sendTime: '10:00' },
    limits: { maxOffsets: 6, maxOffsetDays: 365 },
    quietHours: { start: '20:00', end: '08:00' },
    readinessItems: ['bio', 'headshot', 'description', 'materials'],
    nextRun: {
      status: 'upcoming',
      at: '2026-11-06T15:00:00.000Z',
      offsetDays: 14,
      windowKey: '2026-11-20-14d',
      windows: [],
      reach: { count: 1, names: ['Ada Lee'], waiting: [{ name: 'Ben Ode', until: '2026-11-06T16:00:00.000Z' }], waitingCount: 1 },
    },
    lastRun: null,
    ...overrides,
  };
}

function sample(offsetDays) {
  return {
    offsetDays,
    windowKey: `2026-11-20-${offsetDays}d`,
    fireAt: '2026-11-06T15:00:00.000Z',
    opensAt: '2026-11-06T15:00:00.000Z',
    closesAt: '2026-11-13T15:00:00.000Z',
    state: 'upcoming',
    daysLeft: offsetDays,
    speakerName: 'Ada Lee',
    sample: false,
    to: 'ada@example.test',
    items: ['bio'],
    subject: 'Items we still need for Example Event',
    html: '<p>Hi Ada.</p>',
    text: `Hi Ada. Please send them by Friday. ${offsetDays}`,
  };
}

const PREVIEW = {
  schedule: 'speakers',
  wordingVersion: 'shipped:abc',
  settingsVersion: 'settings-1',
  usedFallback: false,
  audienceCount: 1,
  samples: [sample(14), sample(7), sample(2)],
};

function renderPage() {
  return render(<MemoryRouter><AdminReminderSchedules /></MemoryRouter>);
}

beforeEach(() => {
  callMock.mockReset();
});

describe('AdminReminderSchedules', () => {
  it('states the schedule in words and shows the next run with the zone, the reach and who waits', async () => {
    callMock.mockResolvedValueOnce(state());
    renderPage();
    expect(await screen.findByTestId('schedule-state')).toHaveTextContent('Scheduled speaker reminders are off.');
    expect(callMock).toHaveBeenCalledWith('reminderSchedules', { action: 'get', schedule: 'speakers' });
    const next = screen.getByTestId('next-run');
    expect(next).toHaveTextContent('Next: the 14-day reminder, Friday, November 6, 2026 at 10:00 AM Eastern Standard Time');
    expect(next).toHaveTextContent('America/New_York');
    expect(screen.getByText('It would reach 1 speaker: Ada Lee.')).toBeInTheDocument();
    expect(screen.getByText(/1 speaker waits on the 24-hour limit/)).toBeInTheDocument();
    expect(screen.getByText(/Ben Ode, from/)).toBeInTheDocument();
    expect(screen.getByTestId('last-run')).toHaveTextContent('The schedule has not run yet.');
    expect(screen.getByRole('link', { name: 'Speaker reminders' })).toHaveAttribute('href', '/admin/speakers/reminders/send');
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
  });

  it('previews one sample per offset, approves with the versions the preview returned, and announces the result', async () => {
    callMock
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValueOnce(state({ state: 'on', approval: { wordingVersion: 'shipped:abc', at: '2026-11-01T15:00:00.000Z', by: 'staff@example.test' } }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('heading', { name: 'Preview' })).toBeInTheDocument();
    for (const days of [14, 7, 2]) {
      expect(screen.getByRole('heading', { name: `${days}-day reminder` })).toBeInTheDocument();
      expect(screen.getByTestId(`schedule-preview-text-${days}`)).toHaveTextContent(`Please send them by Friday. ${days}`);
    }
    const resultHeading = screen.getByRole('heading', { name: 'Result' });
    await waitFor(() => expect(resultHeading).toHaveFocus());
    expect(within(resultHeading.parentElement).getByRole('status')).toHaveTextContent('Preview ready: 3 reminders. 1 speaker owes a chosen item now.');

    fireEvent.click(screen.getByRole('button', { name: 'Approve and turn on' }));
    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('Scheduled speaker reminders are on.'));
    expect(callMock).toHaveBeenLastCalledWith('reminderSchedules', {
      schedule: 'speakers', action: 'approve', wordingVersion: 'shipped:abc', settingsVersion: 'settings-1',
    });
    expect(screen.getByText('Approved. Scheduled speaker reminders are on.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { name: 'Result' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('warns when the schedule is on but the wording is no longer the approved wording', async () => {
    callMock.mockResolvedValueOnce(state({ state: 'on', wording: { version: 'v2', matchesApproval: false } }));
    renderPage();
    expect(await screen.findByText(/The reminder wording is not the wording you approved\./)).toHaveAttribute('role', 'status');
  });

  it('shows the paused banner in text, and turns the schedule off', async () => {
    callMock
      .mockResolvedValueOnce(state({
        state: 'paused',
        paused: { reason: 'wording-changed', message: 'The reminder wording changed after it was approved. Preview the wording, then approve it again.', at: '2026-11-02T15:00:00.000Z' },
      }))
      .mockResolvedValueOnce(state());
    renderPage();
    expect(await screen.findByTestId('schedule-state')).toHaveTextContent('Scheduled speaker reminders are paused.');
    expect(screen.getByText('Paused: The reminder wording changed after it was approved. Preview the wording, then approve it again.')).toHaveAttribute('role', 'status');
    expect(screen.getByText(/Nothing sends while the schedule is paused/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('Scheduled speaker reminders are off.'));
    expect(callMock).toHaveBeenLastCalledWith('reminderSchedules', { schedule: 'speakers', action: 'disable' });
  });

  it('saves the settings, and asks for a save before a preview of unsaved settings', async () => {
    callMock
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state({ settings: { offsetsDays: [14, 7, 3], sendTime: '09:30', dueAt: '2026-11-20T22:00:00.000Z', topics: ['headshot', 'description', 'materials'] } }));
    renderPage();
    const third = await screen.findByLabelText('Reminder 3, days before');
    fireEvent.change(third, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Send time'), { target: { value: '09:30' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Biography' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Save the settings first, then preview.')).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(screen.getByText('Settings saved.')).toBeInTheDocument());
    expect(callMock).toHaveBeenLastCalledWith('reminderSchedules', {
      schedule: 'speakers', action: 'save', offsetsDays: [14, 7, 3], sendTime: '09:30', dueAt: '2026-11-20T22:00:00.000Z', topics: ['headshot', 'description', 'materials'],
    });
  });

  it('refuses offsets it cannot save, before any request', async () => {
    callMock.mockResolvedValueOnce(state());
    renderPage();
    fireEvent.change(await screen.findByLabelText('Reminder 1, days before'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findAllByText('Each number of days may appear once.')).not.toHaveLength(0);
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it('says a committed change is saved when the server could not read it back, and reloads', async () => {
    callMock
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(PREVIEW)
      .mockResolvedValueOnce({ schedule: 'speakers', state: 'on', refreshError: 'The change is saved, but the schedule could not be read again. Reload the page.' })
      .mockResolvedValueOnce(state({ state: 'on' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and turn on' }));
    expect(await screen.findByText('The change is saved, but the schedule could not be read again. Reload the page.')).toHaveAttribute('role', 'status');
    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('Scheduled speaker reminders are on.'));
    expect(callMock).toHaveBeenLastCalledWith('reminderSchedules', { action: 'get', schedule: 'speakers' });
  });

  it('states a server refusal in the result', async () => {
    callMock
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(PREVIEW)
      .mockRejectedValueOnce(new Error('The reminder wording changed after the preview. Preview again, then approve.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and turn on' }));
    expect(await screen.findByText('The reminder wording changed after the preview. Preview again, then approve.')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('schedule-state')).toHaveTextContent('off');
  });
});

describe('reminderSchedules helpers', () => {
  it('reads offsets and says why it cannot', () => {
    expect(readOffsetInputs(['2', '14', ' 7 ', ''])).toEqual({ days: [14, 7, 2], problem: null });
    expect(readOffsetInputs(['']).problem).toBe('Enter at least one number of days.');
    expect(readOffsetInputs(['0']).problem).toMatch(/from 1 to 365/);
    expect(readOffsetInputs(['1.5']).problem).toMatch(/whole number/);
  });

  it('words the state, the next run and the last run', () => {
    expect(stateWords('on')).toBe('Scheduled speaker reminders are on.');
    expect(nextRunWords({ status: 'due', offsetDays: 7 }, ZONE)).toBe('The 7-day reminder is due now. The next hourly run sends it.');
    expect(nextRunWords({ status: 'none', message: 'No reminder is left before the due date.' }, ZONE)).toBe('No reminder is left before the due date.');
    expect(lastRunWords({ finishedAt: '2026-11-13T15:31:00.000Z', outcome: 'completed', offsetDays: 7, counts: { sent: 2, waiting: 1 } }, ZONE))
      .toMatch(/^Last run Friday, November 13, 2026 at 10:31 AM Eastern Standard Time \(UTC.05:00\), America\/New_York: the 7-day reminder: sent 2 reminders, 1 speaker waited on the 24-hour limit\.$/);
    expect(lastRunWords({ finishedAt: '2026-11-13T15:31:00.000Z', outcome: 'nothing-due', counts: {} }, ZONE)).toMatch(/nothing was due\.$/);
    expect(lastRunWords({ finishedAt: '2026-11-14T01:00:30.000Z', outcome: 'completed', reason: 'quiet-hours', offsetDays: 7, counts: { sent: 1, deferred: 1 } }, ZONE))
      .toMatch(/sent 1 reminder, quiet hours began, so 1 speaker waits for the next run\.$/);
  });
});
