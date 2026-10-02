import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SpeakerStatusHeader from './SpeakerStatusHeader.jsx';

const EVENT = {
  timezone: 'America/Chicago',
  announcedAt: '2026-01-01T00:00',
  registration: { opensAt: '2026-01-01T00:00', closesAt: '2026-10-14T00:00' },
  days: [
    { id: 'day-1', label: 'Thursday', date: '2026-10-15', startTime: '08:00', endTime: '18:00' },
  ],
};

const SESSIONS = [
  {
    id: 'opening',
    title: 'Opening session',
    dayId: 'day-1',
    startTime: '09:00',
    endTime: '10:00',
    location: 'Room one',
    visible: true,
    speakerIds: ['speaker-own'],
  },
  {
    id: 'later',
    title: 'Later session',
    dayId: 'day-1',
    startTime: '11:00',
    endTime: '12:00',
    location: 'Room two',
    visible: true,
    speakerIds: ['speaker-own'],
  },
];

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SpeakerStatusHeader', () => {
  it('sets the event countdown beside the next assigned session, time, and room', () => {
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    render(
      <SpeakerStatusHeader
        eventConfig={EVENT}
        scheduleData={SESSIONS}
        speakerId="speaker-own"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Opening session' })).toBeInTheDocument();
    expect(screen.getByText('Thursday')).toBeInTheDocument();
    expect(screen.getByText('9:00')).toBeInTheDocument();
    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    expect(screen.getByText('Room one')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Countdown' })).toBeInTheDocument();
  });

  it('keeps the current assigned session beside the current event status', () => {
    vi.setSystemTime(new Date('2026-10-15T14:30:00.000Z'));
    render(
      <SpeakerStatusHeader
        eventConfig={EVENT}
        scheduleData={SESSIONS}
        speakerId="speaker-own"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Opening session' })).toBeInTheDocument();
    expect(screen.getByText('This event is happening now.')).toBeInTheDocument();
  });

  it('states the finished event and removes the stale next-session panel once archived', () => {
    vi.setSystemTime(new Date('2026-10-15T14:30:00.000Z'));
    render(
      <SpeakerStatusHeader
        eventConfig={{ ...EVENT, archivedAt: '2026-10-15T09:00' }}
        scheduleData={SESSIONS}
        speakerId="speaker-own"
      />,
    );

    expect(screen.getByText('This event has ended.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Opening session' })).toBeNull();
    expect(screen.queryByText('Room one')).toBeNull();
  });

  it('states the empty schedule without exposing another speaker or an unresolved row', () => {
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    render(
      <SpeakerStatusHeader
        eventConfig={EVENT}
        scheduleData={[
          { ...SESSIONS[0], speakerIds: ['speaker-other'] },
          { ...SESSIONS[1], startTime: null },
        ]}
        speakerId="speaker-own"
      />,
    );

    expect(screen.getByText('No upcoming session is scheduled.')).toBeInTheDocument();
    expect(screen.queryByText('Room one')).toBeNull();
    expect(screen.queryByText('Room two')).toBeNull();
  });
});
