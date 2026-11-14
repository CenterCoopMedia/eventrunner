import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, emptyAnswers, fullAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';
import { browserTimeZone } from './EventStep.jsx';
import { keepAnswer, readKeptAnswer } from '../../setup/keptAnswers.js';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

function withEvent(event) {
  const answers = emptyAnswers();
  answers.event = { ...answers.event, ...event };
  return { getApplication: { application: application({ answers }) } };
}

beforeEach(() => {
  serveApi(withEvent({}));
});

describe('Your event step', () => {
  it('measures a full 14-day step at every text maxLength against the keepalive body budget', async () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ date: `2027-05-${String(i + 1).padStart(2, '0')}`, startTime: '00:00', endTime: '23:59', label: '' }));
    serveApi(withEvent({ days }));
    const { container } = renderSetup('event');
    await screen.findByLabelText('Event name');
    const fields = container.querySelectorAll('input[type="text"], textarea');
    expect(fields).toHaveLength(19);
    for (const field of fields) {
      // Three UTF-8 bytes per UTF-16 code unit is the largest encoding of
      // ordinary text; dates/times retain their constrained native values.
      fireEvent.change(field, { target: { value: '界'.repeat(field.maxLength) } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Next: Your web address' }));
    await screen.findByRole('heading', { name: 'Your web address' });
    const bytes = new TextEncoder().encode(JSON.stringify(callsTo('saveApplicationStep').at(-1))).byteLength;
    expect(bytes).toBeGreaterThan(57000);
    expect(bytes).toBeLessThan(65536);
  });

  it('asks for the name, short name, description and time zone', async () => {
    renderSetup('event');
    expect(await screen.findByLabelText('Event name')).toBeInTheDocument();
    expect(screen.getByLabelText('Short name')).toHaveAccessibleDescription(/Used in email subjects/);
    expect(screen.getByLabelText('One-line description (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Time zone')).toHaveValue('America/New_York');
  });

  it('presets an empty time zone from the browser and saves it', async () => {
    serveApi(withEvent({ timezone: '' }));
    renderSetup('event');
    const zone = browserTimeZone();
    await waitFor(() => expect(screen.getByLabelText('Time zone')).toHaveValue(zone));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Your web address' }));
    await screen.findByRole('heading', { level: 1, name: 'Your web address' });
    expect(callsTo('saveApplicationStep').at(-1).answers.timezone).toBe(zone);
  });

  it('presets the first day with editable times and saves it without Add a day', async () => {
    renderSetup('event');
    const date = await screen.findByLabelText('Date');
    expect(screen.getByLabelText('Starts')).toHaveValue('09:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('17:00');
    fireEvent.change(date, { target: { value: '2027-05-13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Your web address' }));
    await screen.findByRole('heading', { level: 1, name: 'Your web address' });
    expect(callsTo('saveApplicationStep').at(-1).answers.days).toEqual([
      { date: '2027-05-13', startTime: '09:00', endTime: '17:00' },
    ]);
  });

  it('adds another day, focuses its date, and preserves the first day', async () => {
    serveApi(withEvent({ days: [{ date: '2027-05-13', startTime: '10:00', endTime: '18:00' }] }));
    renderSetup('event');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a day' }));
    const second = within(screen.getByRole('group', { name: 'Day 2' }));
    const date = second.getByLabelText('Date');
    await waitFor(() => expect(date).toHaveFocus());
    expect(second.getByLabelText('Starts')).toHaveValue('09:00');
    expect(second.getByLabelText('Ends')).toHaveValue('17:00');
    fireEvent.change(date, { target: { value: '2027-05-14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Your web address' }));
    await screen.findByRole('heading', { level: 1, name: 'Your web address' });
    expect(callsTo('saveApplicationStep').at(-1).answers.days).toEqual([
      { date: '2027-05-13', startTime: '10:00', endTime: '18:00' },
      { date: '2027-05-14', startTime: '09:00', endTime: '17:00' },
    ]);
  });

  it('does not autosave a preset over an answer kept for recovery', async () => {
    const scope = { userId: 'ana', orgId: 'o1', appId: 'a1' };
    const kept = { step: 'event', answers: { ...emptyAnswers().event,
      days: [{ date: '2027-06-10', startTime: '11:00', endTime: '16:00' }] } };
    keepAnswer(scope, kept);
    vi.useFakeTimers();
    try {
      await act(async () => { renderSetup('event'); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(callsTo('saveApplicationStep')).toHaveLength(0);
      expect(readKeptAnswer(scope, 'event')).toEqual(kept);
      fireEvent.click(screen.getByRole('button', { name: 'Use kept answer' }));
      expect(screen.getByLabelText('Date')).toHaveValue('2027-06-10');
      expect(screen.getByLabelText('Starts')).toHaveValue('11:00');
      expect(screen.getByLabelText('Ends')).toHaveValue('16:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not autosave a displayed first day or save it when closing setup', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => { renderSetup('event'); });
      expect(screen.getByLabelText('Date')).toHaveValue('');
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(callsTo('saveApplicationStep')).toHaveLength(0);
      await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Close setup' })); });
      expect(screen.getByText('Status page')).toBeInTheDocument();
      expect(callsTo('saveApplicationStep')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops Add a day at 14 days and says why', async () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ date: `2027-05-${String(i + 1).padStart(2, '0')}`, startTime: '09:00', endTime: '17:00' }));
    serveApi(withEvent({ days }));
    renderSetup('event');
    const add = await screen.findByRole('button', { name: 'Add a day' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription('An event can have 14 days or fewer.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove day 14' }));
    await waitFor(() => expect(add).toHaveFocus());
    expect(add).toBeEnabled();
  });

  it('removes a day when there is more than one, and moves the focus to Add a day', async () => {
    serveApi(withEvent({
      days: [
        { date: '2027-05-13', startTime: '09:00', endTime: '17:00' },
        { date: '2027-05-14', startTime: '09:00', endTime: '17:00' },
      ],
    }));
    renderSetup('event');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove day 2' }));
    expect(screen.queryByRole('group', { name: 'Day 2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove day 1' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a day' })).toHaveFocus());
  });

  it('shows the errors of each day by field', async () => {
    serveApi({
      ...withEvent({ days: [{ date: '2027-02-30', startTime: '10:00', endTime: '09:00' }] }),
    });
    const answers = emptyAnswers();
    answers.event.days = [{ date: '2027-02-30', startTime: '10:00', endTime: '09:00' }];
    serveApi({
      getApplication: {
        application: application({
          answers,
          errors: {
            'event.days.0.date': 'Enter a real date.',
            'event.days.0.endTime': 'The end time must be after the start time.',
          },
        }),
      },
    });
    renderSetup('event', { query: '?check=1' });
    expect(await screen.findByText('Enter a real date.')).toBeInTheDocument();
    expect(screen.getByLabelText('Ends')).toHaveAccessibleDescription('The end time must be after the start time.');
  });

  it('asks for the venue, which is optional', async () => {
    renderSetup('event');
    expect(await screen.findByRole('heading', { name: 'Venue (optional)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Venue name')).toBeInTheDocument();
    expect(screen.getByLabelText('Venue address')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use organization mailing address' })).not.toBeInTheDocument();
  });

  it('copies the current mailing address once, keeps it independent, and saves an edited venue on Review', async () => {
    const answers = fullAnswers();
    answers.event.venue.address = '';
    serveApi({ getApplication: { application: application({ answers }) } });
    renderSetup('event');
    fireEvent.click(await screen.findByRole('button', { name: 'Use organization mailing address' }));
    expect(screen.getByLabelText('Venue address')).toHaveValue(answers.organization.address);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.change(await screen.findByLabelText('Mailing address'), { target: { value: '99 New Office Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Your event' }));
    expect(await screen.findByLabelText('Venue address')).toHaveValue(answers.organization.address);
    fireEvent.change(screen.getByLabelText('Venue address'), { target: { value: '7 Event Hall Road' } });
    fireEvent.click(screen.getByRole('link', { name: /Review/ }));
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(screen.getByRole('region', { name: 'Your event' })).toHaveTextContent('7 Event Hall Road');
    expect(callsTo('saveApplicationStep').at(-1)).toMatchObject({
      step: 'event', answers: { venue: { address: '7 Event Hall Road' } },
    });
  });
});
