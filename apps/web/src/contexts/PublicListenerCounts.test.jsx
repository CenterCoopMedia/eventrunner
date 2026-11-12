import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';

const { content, config, configCalls, active, peak, track } = vi.hoisted(() => {
  const active = new Map();
  const peak = new Map();
  function track(name, names, key = name) {
    names.add(name);
    const count = (active.get(key) ?? 0) + 1;
    active.set(key, count);
    peak.set(key, Math.max(peak.get(key) ?? 0, count));
    return () => {
      active.set(key, active.get(key) - 1);
      names.delete(name);
    };
  }
  return { content: new Set(), config: new Set(), configCalls: [], active, peak, track };
});
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: (name) => track(name, content),
  subscribeSpeakersPublic: () => track('speakers_public', content),
}));
vi.mock('../lib/configSource.js', () => ({
  subscribeConfigDoc: (name) => { configCalls.push(name); return track(name, config, `config/${name}`); },
}));

import { ContentProvider } from './ContentContext.jsx';
import { EventConfigProvider } from './EventConfigContext.jsx';

beforeEach(() => { content.clear(); config.clear(); configCalls.length = 0; active.clear(); peak.clear(); });

describe('public provider listener budget', () => {
  it.each([
    ['/', ['cmsContent', 'cmsPages', 'cmsOrganizations', 'cmsTimeline'], 7],
    ['/speakers', ['cmsContent', 'cmsPages', 'speakers_public'], 6],
    ['/schedule', ['cmsContent', 'cmsPages', 'cmsSchedule', 'speakers_public'], 7],
  ])('attaches only the required streams on %s, down from 11', (pathname, expected, total) => {
    render(
      <EventConfigProvider pathname={pathname} demoMode={false}>
        <ContentProvider pathname={pathname} publicTools={false}><span>Public route</span></ContentProvider>
      </EventConfigProvider>,
    );
    expect([...config].sort()).toEqual(['event', 'features', 'theme']);
    expect([...content].sort()).toEqual(expected.sort());
    expect(config.size + content.size).toBe(total);
    expect(total).toBeLessThan(11);
  });

  it('attaches badges on first use and keeps them without duplicating on return', () => {
    const view = (pathname) => <EventConfigProvider pathname={pathname}><span>Route</span></EventConfigProvider>;
    const { rerender, unmount } = render(view('/'));
    expect([...config].sort()).toEqual(['event', 'features', 'theme']);
    rerender(view('/profile'));
    expect([...config].sort()).toEqual(['badges', 'event', 'features', 'theme']);
    rerender(view('/speakers'));
    rerender(view('/profile'));
    expect([...config].sort()).toEqual(['badges', 'event', 'features', 'theme']);
    expect(configCalls.filter((name) => name === 'badges')).toHaveLength(1);
    unmount();
    expect(config.size).toBe(0);
  });

  it('keeps one active handle through Strict Mode, route activation, and source changes', () => {
    const view = (pathname, readSource = 'published') => (
      <StrictMode>
        <EventConfigProvider pathname={pathname}>
          <ContentProvider pathname={pathname} readSource={readSource} publicTools={false}><span>Route</span></ContentProvider>
        </EventConfigProvider>
      </StrictMode>
    );
    const { rerender, unmount } = render(view('/'));
    rerender(view('/profile'));
    rerender(view('/schedule'));
    rerender(view('/schedule', 'draft'));
    rerender(view('/schedule', 'published'));
    expect([...active.values()].every((count) => count === 1)).toBe(true);
    expect([...peak.values()].every((count) => count === 1)).toBe(true);
    unmount();
    expect([...active.values()].every((count) => count === 0)).toBe(true);
  });
});
