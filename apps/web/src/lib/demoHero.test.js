import { describe, expect, it, vi } from 'vitest';

vi.mock('./demoMode.js', () => ({ IS_DEMO: true }));
import { demoHero } from './demoHero.js';

describe('demo hero crops', () => {
  it('keeps the NC Local panelists in the shallow Program strip without changing Home', () => {
    const home = demoHero({ preset: 'newsroom' });
    const compact = demoHero({ preset: 'newsroom' }, { compact: true });
    expect(home.focalY).toBe(50);
    expect(compact.focalY).toBe(25);
    expect({ ...compact, focalY: home.focalY }).toEqual(home);
    expect(compact.caption).toContain('Photo: Elon University');
  });

  it('keeps the Field Guide heron in view without changing its full composition', () => {
    expect(demoHero({ preset: 'field-guide' }).focalY).toBe(45);
    expect(demoHero({ preset: 'field-guide' }, { compact: true }).focalY).toBe(5);
  });

  it('does not override the other preset artwork', () => {
    for (const preset of ['civic', 'broadsheet', 'atlas', 'zine']) {
      for (const mode of ['light', 'dark']) {
        expect(demoHero({ preset, mode }, { compact: true })).toEqual(demoHero({ preset, mode }));
      }
    }
  });
});
