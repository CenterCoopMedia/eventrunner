import { describe, expect, it, vi } from 'vitest';
import { ROUTE_PATTERNS } from 'shared/webVitals';
import { prefetchRoutes } from '../routes.jsx';
import { fieldVitalsRoute } from './fieldVitalsRoute.js';

describe('anonymous field route categories', () => {
  it('matches the production registry without custom CMS or specimen paths', () => {
    const categories = prefetchRoutes.filter(({ path }) => path !== 'specimen')
      .map(({ path }) => path === '*' ? '/*' : path.startsWith('/') ? path : `/${path}`);
    expect(new Set(categories)).toEqual(new Set(ROUTE_PATTERNS));
    for (const pattern of ROUTE_PATTERNS) {
      if (pattern === '/*') continue;
      const example = pattern.replace(/:[^/]+\?/g, 'private-step').replace(/:[^/]+/g, 'private-id')
        .replace('*', 'orders/private-id');
      expect(fieldVitalsRoute(`${example}?email=private@example.test#secret`)).toBe(pattern);
    }
  });

  it.each([
    ['/schedule/mine', '/schedule/mine'], ['/schedule/user/private', '/schedule/user/:uid'],
    ['/schedule/private', '/schedule/:sessionId'], ['/attendees/posts/private', '/attendees/posts/:postId'],
    ['/attendees/private', '/attendees/:uid'], ['/pitch', '/pitch/:stepSlug?'],
    ['/speaker/profile', '/speaker/profile/:stepSlug?'], ['/registration', '/registration/:stepSlug?'],
    ['/admin/users/private', '/admin/*'], ['/custom-cms-page', '/*'], ['/unknown/private/path', '/*'],
    ['/specimen', '/*'], ['/attendees/%3Fprivate', '/attendees/:uid'],
    ['https://site.example/attendees/private?token=secret', '/attendees/:uid'],
  ])('reports %s as %s', (path, pattern) => expect(fieldVitalsRoute(path)).toBe(pattern));

  it('drops malformed paths without printing their values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(fieldVitalsRoute('/attendees/%zz-private')).toBe('/*');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
