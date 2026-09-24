// The milestones panel on the overview (issue #180). A page left open across
// midnight on the event's clock has to move "In 1 day" to "Today" by itself
// (connector review of PR 272), so the panel reads the ticking event clock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import MilestonesPanel from './MilestonesPanel.jsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('MilestonesPanel', () => {
  it('moves a countdown when the event day changes while the page stays open', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    // One minute before midnight on Tuesday 13 October in New York (UTC-4).
    vi.setSystemTime(new Date('2026-10-14T03:59:00Z'));
    render(
      <MilestonesPanel
        milestones={[{ label: 'Doors open', date: '2026-10-14' }]}
        goal={null}
        approved={0}
        timezone="America/New_York"
      />,
    );
    expect(screen.getByRole('listitem').textContent).toBe('Doors open, Wednesday, October 14, In 1 day');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('listitem').textContent).toBe('Doors open, Wednesday, October 14, Today');
  });
});
