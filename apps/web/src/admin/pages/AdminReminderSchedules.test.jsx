// The scheduled reminders page (functions/src/reminders/schedules.cjs).
// Mocks adminApi directly, as AdminSpeakerReminders.test.jsx does: the
// endpoint is the only data source, and every message is rendered on the
// server. The page loads two panels, so each answer is routed by the
// request's `schedule`.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));

import AdminReminderSchedules from './AdminReminderSchedules.jsx';
import {
  attendeeLastRunWords,
  attendeeStateWords,
  lastRunWords,
  reachWords,
  nextRunWords,
  readOffsetInputs,
  stateWords,
} from '../reminderSchedules.js';

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

const DEFAULT_DRAFT = {
  subject: 'Your event is {{days_until}} away',
  message: 'The event is {{days_until}} away. The details are below. We look forward to seeing you.',
};

function attendeeState(overrides = {}) {
  return {
    schedule: 'attendees',
    state: 'off',
    settings: { offsetsDays: [7, 1], sendTime: '10:00', draft: { ...DEFAULT_DRAFT } },
    approval: { wordingVersion: null, factsVersion: null, at: null, by: null },
    paused: null,
    wording: { version: 'shipped:def', shipped: true, matchesApproval: false },
    facts: {
      ok: true,
      version: 'facts-1',
      when: 'Tuesday, December 1, 2026 at 9:00 AM EST',
      where: 'Example Hall, Example City',
      ticketUrl: 'https://site.example.test/dashboard',
      ticketLabel: 'Open your dashboard',
      matchesApproval: false,
    },
    channel: { canSend: true, blocker: null, mode: 'app' },
    timeZone: ZONE,
    eventEnded: false,
    defaults: { offsetsDays: [7, 1], sendTime: '10:00', draft: { ...DEFAULT_DRAFT } },
    limits: { maxOffsets: 6, maxOffsetDays: 365, maxSubjectLength: 120, maxMessageLength: 5000 },
    placeholder: '{{days_until}}',
    quietHours: { start: '20:00', end: '08:00' },
    nextRun: {
      status: 'upcoming',
      at: '2026-11-24T15:00:00.000Z',
      offsetDays: 7,
      windowKey: '2026-12-01-7d',
      windows: [],
      reach: { count: 2, suppressed: 1, unusable: 0 },
    },
    lastRun: null,
    ...overrides,
  };
}

function attendeeSample(offsetDays) {
  const days = offsetDays === 1 ? '1 day' : `${offsetDays} days`;
  return {
    offsetDays,
    windowKey: `2026-12-01-${offsetDays}d`,
    fireAt: '2026-11-24T15:00:00.000Z',
    opensAt: '2026-11-24T15:00:00.000Z',
    closesAt: '2026-11-30T15:00:00.000Z',
    state: 'upcoming',
    daysUntil: offsetDays,
    subject: `Your event is ${days} away`,
    html: `<p>The event is ${days} away.</p>`,
    text: `The event is ${days} away.\n\nWhen: Tuesday, December 1, 2026 at 9:00 AM EST\n\nOpen your dashboard: https://site.example.test/dashboard`,
  };
}

const ATTENDEE_PREVIEW = {
  schedule: 'attendees',
  wordingVersion: 'shipped:def',
  settingsVersion: 'att-settings-1',
  factsVersion: 'facts-1',
  recipientCount: 2,
  suppressedCount: 1,
  unusableCount: 0,
  from: 'Example Event <events@example.test>',
  replyTo: null,
  stream: 'announcements',
  unsubscribeNote: 'Each recipient gets their own unsubscribe link at the end of the message. The link in this preview and in a test send changes nothing.',
  canSend: true,
  blocker: null,
  samples: [attendeeSample(7), attendeeSample(1)],
};

/**
 * Answer each request from the queue of its schedule, in order. An Error
 * in a queue is thrown. The attendee panel's first load gets the default
 * attendee state unless a test gives its own queue.
 */
function route({ speakers = [state()], attendees = [attendeeState()] } = {}) {
  const queues = { speakers: [...speakers], attendees: [...attendees] };
  callMock.mockImplementation(async (_name, body) => {
    const queue = queues[body.schedule];
    if (!queue || queue.length === 0) throw new Error(`unexpected ${body.schedule} request: ${body.action}`);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  });
}

function callsFor(schedule) {
  return callMock.mock.calls.filter(([, body]) => body.schedule === schedule);
}

function attendeePanel() {
  return screen.getByRole('heading', { level: 2, name: 'Attendees' }).closest('section');
}

beforeEach(() => {
  callMock.mockReset();
});

describe('AdminReminderSchedules', () => {
  it('states the schedule in words and shows the next run with the zone, the reach and who waits', async () => {
    route({ speakers: [state()] });
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
    route({ speakers: [state(), PREVIEW, state({ state: 'on', approval: { wordingVersion: 'shipped:abc', at: '2026-11-01T15:00:00.000Z', by: 'staff@example.test' } })] });
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
    route({ speakers: [state({ state: 'on', wording: { version: 'v2', matchesApproval: false } })] });
    renderPage();
    expect(await screen.findByText(/The reminder wording is not the wording you approved\./)).toHaveAttribute('role', 'status');
  });

  it('shows the paused banner in text, and turns the schedule off', async () => {
    route({ speakers: [state({
        state: 'paused',
        paused: { reason: 'wording-changed', message: 'The reminder wording changed after it was approved. Preview the wording, then approve it again.', at: '2026-11-02T15:00:00.000Z' },
      }), state()] });
    renderPage();
    expect(await screen.findByTestId('schedule-state')).toHaveTextContent('Scheduled speaker reminders are paused.');
    expect(screen.getByText('Paused: The reminder wording changed after it was approved. Preview the wording, then approve it again.')).toHaveAttribute('role', 'status');
    expect(screen.getByText(/Nothing sends while the schedule is paused/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('Scheduled speaker reminders are off.'));
    expect(callMock).toHaveBeenLastCalledWith('reminderSchedules', { schedule: 'speakers', action: 'disable' });
  });

  it('saves the settings, and asks for a save before a preview of unsaved settings', async () => {
    route({ speakers: [state(), state({ settings: { offsetsDays: [14, 7, 3], sendTime: '09:30', dueAt: '2026-11-20T22:00:00.000Z', topics: ['headshot', 'description', 'materials'] } })] });
    renderPage();
    const third = await screen.findByLabelText('Reminder 3, days before');
    fireEvent.change(third, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Send time'), { target: { value: '09:30' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Biography' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Save the settings first, then preview.')).toBeInTheDocument();
    expect(callsFor('speakers')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(screen.getByText('Settings saved.')).toBeInTheDocument());
    expect(callMock).toHaveBeenLastCalledWith('reminderSchedules', {
      schedule: 'speakers', action: 'save', offsetsDays: [14, 7, 3], sendTime: '09:30', dueAt: '2026-11-20T22:00:00.000Z', topics: ['headshot', 'description', 'materials'],
    });
  });

  it('refuses offsets it cannot save, before any request', async () => {
    route({ speakers: [state()] });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Reminder 1, days before'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findAllByText('Each number of days may appear once.')).not.toHaveLength(0);
    expect(callsFor('speakers')).toHaveLength(1);
  });

  it('says a committed change is saved when the server could not read it back, and reloads', async () => {
    route({ speakers: [state(), PREVIEW, { schedule: 'speakers', state: 'on', refreshError: 'The change is saved, but the schedule could not be read again. Reload the page.' }, state({ state: 'on' })] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and turn on' }));
    expect(await screen.findByText('The change is saved, but the schedule could not be read again. Reload the page.')).toHaveAttribute('role', 'status');
    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('Scheduled speaker reminders are on.'));
    expect(callMock).toHaveBeenLastCalledWith('reminderSchedules', { action: 'get', schedule: 'speakers' });
  });

  it('states a server refusal in the result', async () => {
    route({ speakers: [state(), PREVIEW, new Error('The reminder wording changed after the preview. Preview again, then approve.')] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and turn on' }));
    expect(await screen.findByText('The reminder wording changed after the preview. Preview again, then approve.')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('schedule-state')).toHaveTextContent('off');
  });
});

describe('AdminReminderSchedules, attendees', () => {
  it('states the attendee schedule in words, with the facts, the next run as a count and no addresses', async () => {
    route();
    renderPage();
    expect(await screen.findByTestId('attendee-schedule-state')).toHaveTextContent('Scheduled attendee reminders are off.');
    expect(callMock).toHaveBeenCalledWith('reminderSchedules', { action: 'get', schedule: 'attendees' });
    const panel = within(attendeePanel());
    expect(panel.getByText('Tuesday, December 1, 2026 at 9:00 AM EST')).toBeInTheDocument();
    expect(panel.getByText('Example Hall, Example City')).toBeInTheDocument();
    expect(panel.getByText('https://site.example.test/dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('attendee-next-run')).toHaveTextContent('Next: the 7-day reminder, Tuesday, November 24, 2026 at 10:00 AM Eastern Standard Time');
    expect(panel.getByText('It would reach 2 attendees. 1 address unsubscribed and is left out.')).toBeInTheDocument();
    expect(screen.getByTestId('attendee-last-run')).toHaveTextContent('The schedule has not run yet.');
    expect(panel.getByLabelText('Attendee reminder subject')).toHaveValue(DEFAULT_DRAFT.subject);
    expect(panel.getByLabelText('Attendee reminder message')).toHaveValue(DEFAULT_DRAFT.message);
    expect(panel.queryByRole('button', { name: 'Turn off attendee reminders' })).toBeNull();
  });

  it('saves the settings and the wording, previews each reminder day, and approves with the three versions', async () => {
    const saved = attendeeState({ settings: { offsetsDays: [7, 2], sendTime: '09:30', draft: { subject: 'See you in {{days_until}}', message: 'Doors open at 8.' } } });
    route({
      attendees: [
        attendeeState(),
        saved,
        ATTENDEE_PREVIEW,
        attendeeState({ ...saved, state: 'on', approval: { wordingVersion: 'shipped:def', factsVersion: 'facts-1', at: '2026-11-01T15:00:00.000Z', by: 'staff@example.test' } }),
      ],
    });
    renderPage();
    await screen.findByTestId('attendee-schedule-state');
    const panel = within(attendeePanel());
    fireEvent.change(panel.getByLabelText('Attendee reminder 2, days before'), { target: { value: '2' } });
    fireEvent.change(panel.getByLabelText('Attendee send time'), { target: { value: '09:30' } });
    fireEvent.change(panel.getByLabelText('Attendee reminder subject'), { target: { value: 'See you in {{days_until}}' } });
    fireEvent.change(panel.getByLabelText('Attendee reminder message'), { target: { value: 'Doors open at 8.' } });
    fireEvent.click(panel.getByRole('button', { name: 'Preview attendee reminders' }));
    expect(await panel.findByText('Save the settings first, then preview.')).toBeInTheDocument();
    expect(callsFor('attendees')).toHaveLength(1);

    fireEvent.click(panel.getByRole('button', { name: 'Save attendee settings' }));
    await waitFor(() => expect(panel.getByText('Attendee settings saved.')).toBeInTheDocument());
    expect(callMock).toHaveBeenLastCalledWith('reminderSchedules', {
      schedule: 'attendees', action: 'save', offsetsDays: [7, 2], sendTime: '09:30', draft: { subject: 'See you in {{days_until}}', message: 'Doors open at 8.' },
    });

    fireEvent.click(panel.getByRole('button', { name: 'Preview attendee reminders' }));
    expect(await panel.findByRole('heading', { name: 'Attendee reminder preview' })).toBeInTheDocument();
    for (const days of [7, 1]) {
      expect(panel.getByRole('heading', { name: `Attendee reminder, ${days === 1 ? '1 day' : `${days} days`} before` })).toBeInTheDocument();
    }
    expect(screen.getByTestId('attendee-preview-text-7')).toHaveTextContent('The event is 7 days away.');
    expect(screen.getByTestId('attendee-preview-text-1')).toHaveTextContent('The event is 1 day away.');
    expect(panel.getByText(/It would reach 2 attendees now\. 1 address unsubscribed and is left out\./)).toBeInTheDocument();
    const resultHeading = panel.getByRole('heading', { name: 'Result' });
    await waitFor(() => expect(resultHeading).toHaveFocus());
    expect(within(resultHeading.parentElement).getByRole('status')).toHaveTextContent('Preview ready: 2 reminders.');

    fireEvent.click(panel.getByRole('button', { name: 'Approve and turn on attendee reminders' }));
    await waitFor(() => expect(screen.getByTestId('attendee-schedule-state')).toHaveTextContent('Scheduled attendee reminders are on.'));
    expect(callMock).toHaveBeenLastCalledWith('reminderSchedules', {
      schedule: 'attendees', action: 'approve', wordingVersion: 'shipped:def', settingsVersion: 'att-settings-1', factsVersion: 'facts-1',
    });
    expect(panel.getByText('Approved. Scheduled attendee reminders are on.')).toHaveAttribute('role', 'status');
    // The speaker panel is untouched.
    expect(screen.getByTestId('schedule-state')).toHaveTextContent('Scheduled speaker reminders are off.');
  });

  it('shows a pause for changed facts, and warns when the facts on screen are not the approved ones', async () => {
    route({
      attendees: [attendeeState({
        state: 'paused',
        paused: { reason: 'facts-changed', message: 'The event start, the venue or the ticket link changed after the reminders were approved. Preview the reminders, then approve them again.', at: '2026-11-02T15:00:00.000Z' },
      })],
    });
    renderPage();
    expect(await screen.findByTestId('attendee-schedule-state')).toHaveTextContent('Scheduled attendee reminders are paused.');
    expect(screen.getByText('Paused: The event start, the venue or the ticket link changed after the reminders were approved. Preview the reminders, then approve them again.')).toHaveAttribute('role', 'status');
  });

  it('warns while on when the facts or the wording are no longer the approved ones', async () => {
    route({
      attendees: [attendeeState({
        state: 'on',
        wording: { version: 'v2', shipped: false, matchesApproval: false },
        facts: { ...attendeeState().facts, matchesApproval: false },
      })],
    });
    renderPage();
    expect(await screen.findByText(/The attendee reminder wording is not the wording you approved\./)).toHaveAttribute('role', 'status');
    expect(screen.getByText(/The event start, the venue or the ticket link is not what you approved\./)).toHaveAttribute('role', 'status');
  });

  it('says when announcement email cannot be sent, and offers no approval from such a preview', async () => {
    const blocker = 'Announcement email needs the Postmark or console email provider. The webhook relay has no batch send or unsubscribe contract yet.';
    route({
      attendees: [
        attendeeState({ channel: { canSend: false, blocker, mode: null } }),
        { ...ATTENDEE_PREVIEW, canSend: false, blocker },
      ],
    });
    renderPage();
    expect(await screen.findByText(`Announcement email cannot be sent now: ${blocker}`)).toBeInTheDocument();
    const panel = within(attendeePanel());
    fireEvent.click(panel.getByRole('button', { name: 'Preview attendee reminders' }));
    expect(await panel.findByRole('heading', { name: 'Attendee reminder preview' })).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: 'Approve and turn on attendee reminders' })).toBeNull();
    expect(panel.getByText(`These reminders cannot be approved yet: ${blocker}`)).toBeInTheDocument();
  });

  it('refuses a draft with another placeholder before any request', async () => {
    route();
    renderPage();
    await screen.findByTestId('attendee-schedule-state');
    const panel = within(attendeePanel());
    fireEvent.change(panel.getByLabelText('Attendee reminder subject'), { target: { value: 'Hi {{name}}' } });
    fireEvent.click(panel.getByRole('button', { name: 'Save attendee settings' }));
    expect(await panel.findAllByText('Only {{days_until}} can be used. Remove {{name}}.')).not.toHaveLength(0);
    expect(callsFor('attendees')).toHaveLength(1);
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

  it('words a run cut at its time limit, and the addresses left in a send in progress', () => {
    const at = '2026-11-24T15:31:00.000Z';
    expect(lastRunWords({ finishedAt: at, outcome: 'completed', reason: 'time-limit', offsetDays: 7, counts: { sent: 3, deferred: 2 } }, ZONE))
      .toMatch(/sent 3 reminders, the run reached its time limit, so 2 speakers wait for the next run\.$/);
    expect(attendeeLastRunWords({ finishedAt: at, outcome: 'completed', reason: 'time-limit', offsetDays: 7, counts: { sent: 200, deferred: 1 } }, ZONE))
      .toMatch(/sent 200 emails, the run reached its time limit, so 1 address waits for the next run\.$/);
    expect(reachWords({ count: 1, remaining: true })).toBe('1 address is left in this reminder day’s send.');
    expect(reachWords({ count: 0, remaining: true })).toBe('0 addresses are left in this reminder day’s send.');
  });

  it('words the attendee schedule and its last run, in addresses', () => {
    expect(attendeeStateWords('paused')).toBe('Scheduled attendee reminders are paused.');
    const at = '2026-11-24T15:31:00.000Z';
    expect(attendeeLastRunWords({ finishedAt: at, outcome: 'completed', offsetDays: 7, counts: { sent: 2, suppressed: 1 } }, ZONE))
      .toMatch(/: the 7-day reminder: sent 2 emails, 1 address unsubscribed during the send\.$/);
    expect(attendeeLastRunWords({ finishedAt: at, outcome: 'completed', reason: 'quiet-hours', offsetDays: 7, counts: { sent: 200, deferred: 1 } }, ZONE))
      .toMatch(/sent 200 emails, quiet hours began, so 1 address waits for the next run\.$/);
    expect(attendeeLastRunWords({ finishedAt: at, outcome: 'completed', reason: 'superseded', offsetDays: 7, counts: {} }, ZONE))
      .toMatch(/the send began on an earlier approval, so it stopped and sends no more\.$/);
    expect(attendeeLastRunWords({ finishedAt: at, outcome: 'paused', reason: 'facts-changed', counts: {} }, ZONE))
      .toMatch(/the event start, the venue or the ticket link was not the approved one, so it sent nothing and paused the schedule\.$/);
    expect(attendeeLastRunWords({ finishedAt: at, outcome: 'failed', error: { message: 'The announcement stream is archived.' }, counts: {} }, ZONE))
      .toMatch(/it stopped: The announcement stream is archived\.\.?$/);
  });
});
