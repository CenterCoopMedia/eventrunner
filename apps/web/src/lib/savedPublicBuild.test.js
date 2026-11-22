import { expect, it, vi } from 'vitest';
import { hasStalePublicReads, recordPublicRead } from './savedPublicBuild.js';
import { isNetworkOnlyPath, needsNetworkDocument } from './offlineRoutes.js';

it('tracks current server confirmation for each dataset and ages interrupted reads', () => {
  const marker = document.createElement('meta');
  marker.name = 'eventrunner-saved-build';
  marker.content = 'revision|2026-11-22T15:00:00Z|2026-11-22T14:00:00Z';
  document.head.append(marker);
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const start = Date.parse('2026-11-22T15:00:00Z');
    vi.setSystemTime(start);
    recordPublicRead('cmsSchedule', 'server');
    expect(hasStalePublicReads(['cmsSchedule', 'cmsUpdates'])).toBe(true);
    recordPublicRead('cmsUpdates', 'server');
    expect(hasStalePublicReads(['cmsSchedule', 'cmsUpdates'], start + 300_000)).toBe(false);
    recordPublicRead('cmsSchedule', 'interrupted');
    expect(hasStalePublicReads(['cmsSchedule'], start + 299_999)).toBe(false);
    expect(hasStalePublicReads(['cmsSchedule'], start + 300_000)).toBe(true);
    recordPublicRead('cmsUpdates', 'cache');
    expect(hasStalePublicReads(['cmsUpdates'])).toBe(true);
    expect(hasStalePublicReads(['cmsSchedule'], start - 1)).toBe(true);
  } finally {
    recordPublicRead('cmsSchedule', 'cache');
    recordPublicRead('cmsUpdates', 'cache');
    vi.useRealTimers();
    marker.remove();
  }
});

it('uses the network for account routes and keeps My schedule code usable within the saved app', () => {
  for (const path of ['/signin', '/tickets', '/profile/organization', '/schedule/user/reader', '/admin/content']) {
    expect(needsNetworkDocument(path, '')).toBe(true);
  }
  expect(needsNetworkDocument('/schedule/session', '?preview=1')).toBe(true);
  expect(needsNetworkDocument('/schedule/session', '?lang=es')).toBe(false);
  expect(isNetworkOnlyPath('/schedule/mine')).toBe(true);
  expect(needsNetworkDocument('/schedule/mine', '')).toBe(false);
});
