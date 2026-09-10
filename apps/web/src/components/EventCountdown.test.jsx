// EventCountdown: the home lead's lifecycle-aware line (M7 issue 7). Drives
// all four phases the issue names — announced, in_progress, ended, and
// archived — plus draft (which must NOT count down: counting is an
// allowlist of the phases before the event starts, not everything that
// isn't in_progress/ended/archived), the boundary transition that proves
// the lead never shows a negative figure, the running line's own low
// frequency check that moves it on to "ended" without a reload, draft's
// matching low frequency check that brings the lead up on its own once a
// future announcedAt passes, and that the ticking interval is cleared on
// unmount.
//
// Timer hygiene matters here specifically because this component schedules
// real setInterval calls whenever it renders outside a test's own fake
// clock: `afterEach` hooks run in reverse registration order (a describe's
// own hooks before the ones the global test setup registers), so a bare
// `afterEach(() => vi.useRealTimers())` here would restore native timers
// BEFORE @testing-library's own global cleanup() unmounts whatever this
// file last rendered — an interval scheduled under the fake clock, orphaned
// rather than cleared, with no render left mounted to ever clear it. Every
// test below renders under `vi.useFakeTimers()`, and the shared afterEach
// unmounts before switching the clock back, so a real timer is never the
// one left holding the id.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
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
  // Order matters: unmount (clearing any interval this file's render
  // scheduled) while the fake clock this file is still active, THEN
  // restore native timers. Reversed, a still-mounted render's interval
  // would be orphaned under the fake clock rather than cleared.
  cleanup();
  vi.useRealTimers();
});

describe('EventCountdown', () => {
  // Exactly 1 day, 2 hours, 3 minutes, 9 seconds before day 1's start — four
  // distinct digits, and still distinct one tick later (…3:08), so each
  // assertion below can match on text without colliding with a sibling unit.
  const BEFORE_START = '2026-06-09T06:56:51.000Z';

  it('counts down while the phase is announced, in the mono face with tabular figures, under a visible accessible label', () => {
    vi.setSystemTime(new Date(BEFORE_START));
    expect(getEventPhase(BASE_CONFIG, new Date(BEFORE_START))).toBe('announced');
    const { container } = render(<EventCountdown eventConfig={BASE_CONFIG} />);

    // The days figure carries no zero padding (it varies in width on its
    // own); hours, minutes, and seconds keep two digits.
    const days = screen.getByText('1');
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

    // A stated, visible label above the figures — not a live region — gives
    // the group of numbers a name in words.
    const label = screen.getByText('Countdown');
    const dl = container.querySelector('dl');
    expect(dl).toHaveAttribute('aria-labelledby', label.id);
    expect(dl).not.toHaveAttribute('aria-live');
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

  it('clears the ticking interval on unmount', () => {
    vi.setSystemTime(new Date(BEFORE_START));
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<EventCountdown eventConfig={BASE_CONFIG} />);
    expect(clearSpy).not.toHaveBeenCalled();
    unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });

  it('clears the once-a-minute draft poll on unmount, the same way', () => {
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    const draftConfig = { ...BASE_CONFIG, announcedAt: '2026-06-01T00:01' };
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<EventCountdown eventConfig={draftConfig} />);
    expect(clearSpy).not.toHaveBeenCalled();
    unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });

  it('clears the once-a-minute running poll on unmount, the same way', () => {
    vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<EventCountdown eventConfig={BASE_CONFIG} />);
    expect(clearSpy).not.toHaveBeenCalled();
    unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });

  it('does not count down in draft: counting is an allowlist of the phases before the event, not everything outside in_progress/ended/archived', () => {
    // No announcedAt at all — the lifecycle clock reads this as draft.
    const draftConfig = { ...BASE_CONFIG, announcedAt: undefined };
    const at = new Date(BEFORE_START);
    vi.setSystemTime(at);
    expect(getEventPhase(draftConfig, at)).toBe('draft');
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { container } = render(<EventCountdown eventConfig={draftConfig} />);
    expect(container).toBeEmptyDOMElement();
    // No announcedAt means no boundary ever arrives on the clock alone, so
    // nothing here schedules a timer waiting for one.
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });

  it('polls about once a minute (never once a second) while draft with a future announcedAt, so the lead appears on its own once that boundary passes', () => {
    const start = new Date('2026-06-01T00:00:00.000Z');
    vi.setSystemTime(start);
    // One minute ahead of "now" — draft until the clock reaches it. days
    // stay far in the future so what follows draft is a counting phase,
    // not in_progress, and the countdown is what proves the lead appeared.
    const draftConfig = { ...BASE_CONFIG, announcedAt: '2026-06-01T00:01' };
    expect(getEventPhase(draftConfig, start)).toBe('draft');

    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    render(<EventCountdown eventConfig={draftConfig} />);
    expect(screen.queryByText('Countdown')).toBeNull();
    // A single low-frequency timer, not a once-a-second one: draft carries
    // no figures a per-second tick would ever move.
    expect(intervalSpy).toHaveBeenCalledTimes(1);
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    intervalSpy.mockRestore();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(getEventPhase(draftConfig, new Date('2026-06-01T00:01:00.000Z'))).not.toBe('draft');
    expect(screen.getByText('Countdown')).toBeInTheDocument();
  });

  it('stops counting and states that the event is running at in_progress', () => {
    const at = new Date('2026-06-10T12:00:00.000Z');
    vi.setSystemTime(at);
    expect(getEventPhase(BASE_CONFIG, at)).toBe('in_progress');
    const { container } = render(<EventCountdown eventConfig={BASE_CONFIG} />);
    expect(screen.getByText('This event is happening now.')).toBeInTheDocument();
    expect(container.querySelector('dl')).toBeNull();
  });

  it('checks about once a minute while running, so it moves on to the ended line on its own once the last day is over — no reload needed', () => {
    // One minute before day 2 (the last day) ends.
    const start = new Date('2026-06-11T16:59:00.000Z');
    vi.setSystemTime(start);
    expect(getEventPhase(BASE_CONFIG, start)).toBe('in_progress');
    render(<EventCountdown eventConfig={BASE_CONFIG} />);
    expect(screen.getByText('This event is happening now.')).toBeInTheDocument();

    // A tick smaller than the check interval changes nothing yet.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('This event is happening now.')).toBeInTheDocument();

    // Two more once-a-minute checks land after the event's own end (the
    // lifecycle clock compares at minute precision, so the check that
    // lands exactly on the boundary minute does not flip it — the one
    // after does, on its own, with no remount).
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(screen.getByText('This event has ended.')).toBeInTheDocument();
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
  });

  it('renders nothing before in_progress when the event has no resolvable start', () => {
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    const { container } = render(
      <EventCountdown eventConfig={{ timezone: ZONE, announcedAt: '2026-01-01T00:00', days: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
