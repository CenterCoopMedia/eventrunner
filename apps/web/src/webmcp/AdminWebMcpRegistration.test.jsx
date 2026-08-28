import { describe, expect, it } from 'vitest';
import {
  adminToolsEnabled,
  currentAdminPageId,
} from './AdminWebMcpRegistration.jsx';

describe('admin WebMCP registration gate', () => {
  it('requires the explicit feature, a user, and a completed admin gate', () => {
    const user = { uid: 'admin' };
    expect(adminToolsEnabled({
      features: { webmcpAdmin: true },
      user,
      adminStatus: 'admin',
    })).toBe(true);
    expect(adminToolsEnabled({ features: {}, user, adminStatus: 'admin' })).toBe(false);
    expect(adminToolsEnabled({
      features: { webmcpAdmin: true },
      user: null,
      adminStatus: 'admin',
    })).toBe(false);
    expect(adminToolsEnabled({
      features: { webmcpAdmin: true },
      user,
      adminStatus: 'denied',
    })).toBe(false);
  });

  it('derives the page id only from an open page-editor route', () => {
    expect(currentAdminPageId('/admin/pages/home')).toBe('home');
    expect(currentAdminPageId('/admin/pages/new')).toBeNull();
    expect(currentAdminPageId('/admin/pages/home/extra')).toBeNull();
    expect(currentAdminPageId('/admin/system-errors')).toBeNull();
  });
});

