import { describe, expect, it } from 'vitest';
import { adminReturnPath } from './adminReturnPath.js';

describe('adminReturnPath', () => {
  it('keeps an in-app admin route', () => {
    expect(adminReturnPath('/admin')).toBe('/admin');
    expect(adminReturnPath('/admin/pages')).toBe('/admin/pages');
    expect(adminReturnPath('/admin/content/home?section=details')).toBe('/admin/content/home?section=details');
  });

  it('refuses a path that can leave the admin CMS', () => {
    for (const value of [
      null,
      undefined,
      '',
      '/signin',
      '/administrator',
      '//admin',
      '/admin//evil',
      '/admin/../signin',
      'https://evil.test/admin',
      'http://eventrunner-demo.web.app/admin',
      '/\\admin',
    ]) {
      expect(adminReturnPath(value)).toBeNull();
    }
  });
});
