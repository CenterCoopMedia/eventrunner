import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

let speakers;

vi.mock('../../contexts/ContentContext.jsx', () => ({
  useContent: () => ({ speakers }),
}));

vi.mock('./SpeakerSessionMaterials.jsx', () => ({
  default: ({ sessionId }) => <p>Materials for {sessionId}</p>,
}));

const { default: SpeakerSessionHub } = await import('./SpeakerSessionHub.jsx');

const EVENT = {
  timezone: 'UTC',
  days: [
    { id: 'day-1', label: 'Thursday', date: '2026-10-15', startTime: '08:00', endTime: '18:00' },
  ],
};

const SESSIONS = [
  {
    id: 'session-one',
    title: 'First session',
    dayId: 'day-1',
    startTime: '09:00',
    endTime: '10:00',
    location: 'Room one',
    type: 'workshop',
    description: '<img src=x onerror=alert(1)>\nA practical session.',
    visible: true,
    speakerIds: ['speaker-own', 'speaker-public', 'speaker-private'],
  },
  {
    id: 'session-two',
    title: 'Second session',
    dayId: 'day-1',
    startTime: '11:00',
    endTime: '12:00',
    location: 'Room two',
    type: 'panel',
    description: 'A second description.',
    visible: true,
    speakerIds: ['speaker-own', 'speaker-second'],
  },
  {
    id: 'foreign-session',
    title: 'Another speaker session',
    dayId: 'day-1',
    startTime: '08:00',
    endTime: '09:00',
    visible: true,
    speakerIds: ['speaker-public'],
  },
];

beforeEach(() => {
  speakers = [
    { id: 'speaker-own', displayName: 'Own Speaker', slug: 'own-speaker' },
    { id: 'speaker-public', displayName: 'Public Co-speaker', slug: 'public-co-speaker' },
    { id: 'speaker-second', displayName: 'Second Co-speaker', slug: 'second-co-speaker' },
  ];
});

describe('SpeakerSessionHub', () => {
  it('separates a known day from the missing-time message', () => {
    render(
      <SpeakerSessionHub
        eventConfig={EVENT}
        scheduleData={[{ ...SESSIONS[0], startTime: null, endTime: null }]}
        speakerId="speaker-own"
      />,
    );

    expect(screen.getByText('Time').nextElementSibling).toHaveTextContent('Thursday · To be announced');
  });

  it('changes between the speaker own sessions and renders description as text', () => {
    const { container } = render(
      <SpeakerSessionHub
        eventConfig={EVENT}
        scheduleData={SESSIONS}
        speakerId="speaker-own"
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Session' });
    expect(select).toHaveValue('session-one');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'First session',
      'Second session',
    ]);
    expect(screen.getByText('Room one')).toBeInTheDocument();
    expect(screen.getByText('workshop')).toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();

    fireEvent.change(select, { target: { value: 'session-two' } });
    expect(select).toHaveValue('session-two');
    expect(screen.getByText('Room two')).toBeInTheDocument();
    expect(screen.getByText('panel')).toBeInTheDocument();
    expect(screen.getByText('A second description.')).toBeInTheDocument();
  });

  it('moves between details and public co-speakers with Arrow, Home, and End', () => {
    render(
      <SpeakerSessionHub
        eventConfig={EVENT}
        scheduleData={SESSIONS}
        speakerId="speaker-own"
      />,
    );

    const details = screen.getByRole('tab', { name: 'Details' });
    const coSpeakers = screen.getByRole('tab', { name: 'Co-speakers' });
    const materials = screen.getByRole('tab', { name: 'Materials' });
    details.focus();
    fireEvent.keyDown(details, { key: 'ArrowRight' });
    expect(coSpeakers).toHaveFocus();
    expect(coSpeakers).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Public Co-speaker')).toBeInTheDocument();
    expect(screen.queryByText('Own Speaker')).toBeNull();
    expect(screen.queryByText('speaker-private')).toBeNull();

    fireEvent.keyDown(coSpeakers, { key: 'Home' });
    expect(details).toHaveFocus();
    expect(details).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(details, { key: 'End' });
    expect(materials).toHaveFocus();
    expect(materials).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Materials for session-one')).toBeInTheDocument();

    fireEvent.keyDown(materials, { key: 'ArrowLeft' });
    expect(coSpeakers).toHaveFocus();
    expect(coSpeakers).toHaveAttribute('aria-selected', 'true');

    fireEvent.change(screen.getByRole('combobox', { name: 'Session' }), {
      target: { value: 'session-two' },
    });
    expect(screen.getByText('Second Co-speaker')).toBeInTheDocument();
    expect(screen.queryByText('Public Co-speaker')).toBeNull();
  });

  it('states when this speaker has no visible assigned sessions', () => {
    render(
      <SpeakerSessionHub
        eventConfig={EVENT}
        scheduleData={SESSIONS.map((session) => ({ ...session, visible: false }))}
        speakerId="speaker-own"
      />,
    );

    expect(screen.getByText('No sessions are assigned to you.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Session' })).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('opens a linked session materials tab without reopening it after a schedule update', () => {
    const props = {
      eventConfig: EVENT,
      scheduleData: SESSIONS,
      speakerId: 'speaker-own',
      requestedSessionId: 'session-two',
      requestedTab: 'materials',
      navigationKey: 'first-navigation',
    };
    const { rerender } = render(<SpeakerSessionHub {...props} />);

    expect(screen.getByRole('combobox', { name: 'Session' })).toHaveValue('session-two');
    expect(screen.getByRole('tab', { name: 'Materials' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Materials for session-two')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    rerender(<SpeakerSessionHub {...props} scheduleData={[...SESSIONS]} />);
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');

    rerender(<SpeakerSessionHub {...props} navigationKey="second-navigation" />);
    expect(screen.getByRole('tab', { name: 'Materials' })).toHaveAttribute('aria-selected', 'true');

    rerender(<SpeakerSessionHub {...props} requestedSessionId={null} requestedTab={null} navigationKey="back" />);
    expect(screen.getByRole('combobox', { name: 'Session' })).toHaveValue('session-one');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');

    rerender(<SpeakerSessionHub {...props} navigationKey="forward" />);
    expect(screen.getByRole('combobox', { name: 'Session' })).toHaveValue('session-two');
    expect(screen.getByRole('tab', { name: 'Materials' })).toHaveAttribute('aria-selected', 'true');
  });
});
