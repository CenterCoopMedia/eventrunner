import { describe, expect, it } from 'vitest';
import { adminRoute, publicRoutes } from '../routes.jsx';
import { publicSubscriptionsForRoute, PUBLIC_SUBSCRIPTION_ROUTES, RUNTIME_COLLECTIONS } from './publicSubscriptions.js';

describe('public subscription route contract', () => {
  it('covers every named application route without adding a route that does not exist', () => {
    const actual = PUBLIC_SUBSCRIPTION_ROUTES.map(({ path }) => path).sort();
    const expected = ['/', `/${adminRoute.path}`,
      ...publicRoutes.filter(({ path }) => path !== '*').map(({ path }) => `/${path}`)].sort();
    expect(actual).toEqual(expected);
  });

  it.each([
    ['/', ['cmsContent', 'cmsPages', 'cmsOrganizations', 'cmsTimeline']],
    ['/speakers', ['cmsContent', 'cmsPages', 'speakers_public']],
    ['/schedule', ['cmsContent', 'cmsPages', 'cmsSchedule', 'speakers_public']],
    ['/speaker/dashboard', ['cmsContent', 'cmsPages', 'cmsSchedule', 'speakers_public']],
    ['/dashboard', ['cmsContent', 'cmsPages', 'cmsSchedule', 'badges']],
    ['/attendees/person', ['cmsContent', 'cmsPages', 'badges']],
    ['/attendees/posts/thread', ['cmsContent', 'cmsPages']],
    ['/profile/change-requests', ['cmsContent', 'cmsPages']],
    ['/profile/organization', ['cmsContent', 'cmsPages']],
  ])('gives %s its required public streams', (path, expected) => {
    expect(publicSubscriptionsForRoute(path).sort()).toEqual(expected.sort());
  });

  it.each([undefined, '/custom-page', '/missing/nested', '/admin/pages'])('keeps all streams for %s', (path) => {
    expect(publicSubscriptionsForRoute(path).sort()).toEqual([...RUNTIME_COLLECTIONS, 'badges'].sort());
  });

  it('keeps all streams for preview without choosing the authenticated data source', () => {
    expect(publicSubscriptionsForRoute('/speakers', '?preview=1').sort())
      .toEqual([...RUNTIME_COLLECTIONS, 'badges'].sort());
  });

  it('keeps the enabled public schedule tool live on a non-schedule route', () => {
    expect(publicSubscriptionsForRoute('/signin', '', true).sort())
      .toEqual(['cmsContent', 'cmsPages', 'cmsSchedule'].sort());
  });
});
