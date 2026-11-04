import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, emptyAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';
import { browserTimeZone } from './EventStep.jsx';

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
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { level: 1, name: 'Your web address' });
    expect(callsTo('saveApplicationStep').at(-1).answers.timezone).toBe(zone);
  });

  it('adds a day, focuses its date, and saves the days', async () => {
    renderSetup('event');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a day' }));
    const date = screen.getByLabelText('Date');
    await waitFor(() => expect(date).toHaveFocus());
    expect(screen.getByLabelText('Starts')).toHaveValue('09:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('17:00');
    fireEvent.change(date, { target: { value: '2027-05-13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { level: 1, name: 'Your web address' });
    expect(callsTo('saveApplicationStep').at(-1).answers.days).toEqual([
      { date: '2027-05-13', startTime: '09:00', endTime: '17:00' },
    ]);
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
  });
});
