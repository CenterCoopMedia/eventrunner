// Which admin screens use the whole workspace (issue #1153). The routes are
// the ones AdminApp.jsx declares.
import { describe, expect, it } from 'vitest';
import { adminScreenWidth } from './screenWidth.js';

describe('adminScreenWidth', () => {
  it('gives lists and dashboards the whole workspace', () => {
    for (const path of ['/admin', '/admin/overview', '/admin/pages', '/admin/sessions', '/admin/speakers', '/admin/attendees', '/admin/versions', '/admin/media', '/admin/access', '/admin/import']) {
      expect(adminScreenWidth(path), path).toBe('wide');
    }
  });

  it('gives the page and content editors the whole workspace', () => {
    for (const path of ['/admin/pages/travel', '/admin/pages/new', '/admin/content/home', '/admin/content/home/hero', '/admin/content/home/hero/title', '/admin/content/home/hero/_new']) {
      expect(adminScreenWidth(path), path).toBe('wide');
    }
  });

  it('keeps plain forms and single-record editors bounded', () => {
    for (const path of ['/admin/settings', '/admin/features', '/admin/setup/basics', '/admin/sessions/abc', '/admin/speakers/new', '/admin/organizations/acme', '/admin/invoices/settings', '/admin/versions/cmsPages/home', '/admin/pages/links/new', '/admin/pages/links/abc']) {
      expect(adminScreenWidth(path), path).toBe('form');
    }
  });

  it('reads a path the way the router matches it', () => {
    expect(adminScreenWidth('/Admin/pages/home')).toBe('wide');
    expect(adminScreenWidth('/admin/%70ages/home')).toBe('wide');
    expect(adminScreenWidth('/admin/Settings')).toBe('form');
    expect(adminScreenWidth('/admin/%E0%A4%A')).toBe('form');
  });
});
