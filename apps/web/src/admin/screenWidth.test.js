// Which admin screens use the whole workspace (issue #1153). The routes are
// the ones AdminApp.jsx declares.
import { describe, expect, it } from 'vitest';
import { adminScreenWidth } from './screenWidth.js';

describe('adminScreenWidth', () => {
  it('gives lists and dashboards the whole workspace', () => {
    for (const path of ['/admin', '/admin/overview', '/admin/pages', '/admin/sessions', '/admin/speakers', '/admin/attendees', '/admin/versions', '/admin/media']) {
      expect(adminScreenWidth(path), path).toBe('wide');
    }
  });

  it('gives the page and content editors the whole workspace', () => {
    for (const path of ['/admin/pages/travel', '/admin/pages/new', '/admin/content/home', '/admin/content/home/hero', '/admin/content/home/hero/title', '/admin/content/home/hero/_new']) {
      expect(adminScreenWidth(path), path).toBe('wide');
    }
  });

  it('keeps plain forms and single-record editors bounded', () => {
    for (const path of ['/admin/settings', '/admin/features', '/admin/access', '/admin/setup/basics', '/admin/sessions/abc', '/admin/speakers/new', '/admin/organizations/acme', '/admin/invoices/settings', '/admin/versions/cmsPages/home']) {
      expect(adminScreenWidth(path), path).toBe('form');
    }
  });
});
