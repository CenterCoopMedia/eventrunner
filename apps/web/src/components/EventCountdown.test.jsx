// EventCountdown: the home lead's lifecycle-aware line (M7 issue 7). Drives
// all four phases the issue names — announced, in_progress, ended, and
// archived — from the same `getEventPhase` clock the rest of the site reads,
// plus the boundary transition that proves the lead never shows a negative
// figure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { getEventPhase } from 'shared/config';
import EventCountdown from './EventCountdown.jsx';

const ZONE = 'UTC';

// A two-day event: day 1 starts 2026-06-10T09:00Z and day 2 ends
// 2026-06-11T17:00Z. announcedAt is far enough in the past that the
// 'announced' fixture below never falls back to 'draft', and
// registration.opensAt is later than every "before in_progress" instant
// this file renders at, so `getEventPhase` reads exactly 'announced' there
// rather than falling through to 'registration_open' — the literal phase
// name the issue lists.
const BASE_CONFIG = {
  timezone: ZONE,
  announcedAt: '2026-01-01T00:00',
  registration: { opensAt: '2026-06-09T12:00' },
  days: [
    { id: 'day-1', date: '2026-06-10', startTime: '09:00', endTime: '17:00' },
    { id: 'day-2', date: '2026-06-11', startTime: '09:00', endTime: '17:00' },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EventCountdown', () => {
  // Exactly 1 day, 2 hours, 3 minutes, 9 seconds before day 1's start — four
  // distinct digits, and still distinct one tick later (…3:08), so each
  // assertion below can match on text without colliding with a sibling unit.
  const BEFORE_START = '2026-06-09T06:56:51.000Z';

  it('counts down while the phase is announced, in the mono face with tabular figures', () => {
    vi.setSystemTime(new Date(BEFORE_START));
    expect(getEventPhase(BASE_CONFIG, new Date(BEFORE_START))).toBe('announced');
    render(<EventCountdown eventConfig={BASE_CONFIG} />);

    const days = screen.getByText('01');
    const hours = screen.getByText('02');
    const minutes = screen.getByText('03');
    const seconds = screen.getByText('09');
    expect(days.className).toContain('font-mono');
    expect(days).toHaveAttribute('data-numeric');
    expect(hours).toBeInTheDocument();
    expect(minutes).toBeInTheDocument();
    expect(seconds).toBeInTheDocument();
    expect(screen.getByText('Days')).toBeInTheDocument();
    expect(screen.getByText('Hours')).toBeInTheDocument();
    expect(screen.getByText('Minutes')).toBeInTheDocument();
    expect(screen.getByText('Seconds')).toBeInTheDocument();
  });

  it('ticks the displayed figures once a second', () => {
    vi.setSystemTime(new Date(BEFORE_START));
    render(<EventCountdown eventConfig={BASE_CONFIG} />);
    expect(screen.getByText('09')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('08')).toBeInTheDocument();
    expect(screen.queryByText('09')).toBeNull();
  });

  it('stops counting and states that the event is running at in_progress', () => {
    const at = new Date('2026-06-10T12:00:00.000Z');
    vi.setSystemTime(at);
    expect(getEventPhase(BASE_CONFIG, at)).toBe('in_progress');
    const { container } = render(<EventCountdown eventConfig={BASE_CONFIG} />);
    expect(screen.getByText('This event is happening now.')).toBeInTheDocument();
    expect(container.querySelector('dl')).toBeNull();
  });

  it('shows the stated post event line once the event has ended', () => {
    const at = new Date('2026-06-12T00:00:00.000Z');
    vi.setSystemTime(at);
    expect(getEventPhase(BASE_CONFIG, at)).toBe('ended');
    render(<EventCountdown eventConfig={BASE_CONFIG} />);
    expect(screen.getByText('This event has ended.')).toBeInTheDocument();
  });

  it('shows the same stated post event line once the event is archived', () => {
    const archived = { ...BASE_CONFIG, archivedAt: '2026-07-01T00:00' };
    const at = new Date('2026-07-02T00:00:00.000Z');
    vi.setSystemTime(at);
    expect(getEventPhase(archived, at)).toBe('archived');
    render(<EventCountdown eventConfig={archived} />);
    expect(screen.getByText('This event has ended.')).toBeInTheDocument();
  });

  it('never shows a negative figure: crossing into in_progress mid-tick swaps the digits for the running line', () => {
    // Two seconds before the event starts.
    vi.setSystemTime(new Date('2026-06-10T08:59:58.000Z'));
    render(<EventCountdown eventConfig={BASE_CONFIG} />);
    expect(screen.getByText('02')).toBeInTheDocument(); // seconds remaining

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // The clock has crossed the event's own start instant. The phase reads
    // in_progress on the next tick, and the lead reads the running line —
    // never a countdown gone negative.
    expect(screen.getByText('This event is happening now.')).toBeInTheDocument();
    expect(screen.queryByText(/^-/)).toBeNull();
  });

  it('renders nothing before in_progress when the event has no resolvable start', () => {
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    const { container } = render(
      <EventCountdown eventConfig={{ timezone: ZONE, announcedAt: '2026-01-01T00:00', days: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
