import { beforeEach, describe, expect, it, vi } from 'vitest';

let readCommandRecents;
let rememberCommandRecord;
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  window.localStorage.clear();
  ({ readCommandRecents, rememberCommandRecord } = await import('./commandMenuRecents.js'));
});

describe('command menu recents', () => {
  it('keeps ten distinct records, newest first, and updates a revisited title', () => {
    for (let i = 0; i < 12; i += 1) rememberCommandRecord('one', { to: `/admin/pages/p${i}`, label: `Page ${i}` });
    rememberCommandRecord('one', { to: '/admin/pages/p5', label: 'Renamed page' });
    const items = readCommandRecents('one');
    expect(items).toHaveLength(10);
    expect(items[0]).toEqual({ to: '/admin/pages/p5', label: 'Renamed page' });
    expect(items.filter((item) => item.to === '/admin/pages/p5')).toHaveLength(1);
    expect(items.some((item) => item.to === '/admin/pages/p0')).toBe(false);
  });

  it('persists per account through a reload and exposes nothing to a second or signed-out account', async () => {
    rememberCommandRecord('first/account', { to: '/admin/sessions/opening', label: 'Opening session' });
    rememberCommandRecord('second', { to: '/admin/pages/home', label: 'Home page' });
    vi.resetModules();
    ({ readCommandRecents } = await import('./commandMenuRecents.js'));
    expect(readCommandRecents('first/account')).toEqual([{ to: '/admin/sessions/opening', label: 'Opening session' }]);
    expect(readCommandRecents('second')).toEqual([{ to: '/admin/pages/home', label: 'Home page' }]);
    expect(readCommandRecents('third')).toEqual([]);
    expect(readCommandRecents(null)).toEqual([]);
  });

  it('keeps this account’s tab recents when storage reads and writes throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage refused'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage refused'); });
    rememberCommandRecord('one', { to: '/admin/updates/news', label: 'News update' });
    expect(readCommandRecents('one')).toEqual([{ to: '/admin/updates/news', label: 'News update' }]);
    expect(readCommandRecents('two')).toEqual([]);
  });

  it('accepts the six publishable editors and excludes attendees, actions, lists, new records and external paths', () => {
    const allowed = ['/admin/pages/home', '/admin/sessions/opening', '/admin/organizations/newsroom', '/admin/updates/news', '/admin/timeline/founding', '/admin/content/home/intro/body', '/admin/sessions/new', '/admin/organizations/new', '/admin/updates/new', '/admin/timeline/new'];
    const excluded = ['/admin/attendees/private', '/admin/access', '/admin/speakers/person', '/admin/pages', '/admin/pages/new', '/admin/sessions/new/session', '/admin/content/home/intro/_new', '//example.test/admin/pages/home', 'javascript:alert(1)'];
    for (const to of [...allowed, ...excluded]) rememberCommandRecord('one', { to, label: 'Record' });
    expect(readCommandRecents('one').map((item) => item.to)).toEqual(allowed.toReversed());
  });

  it('ignores corrupt storage and refuses a stored external or attendee option', () => {
    window.localStorage.setItem('eventrunner.adminCommands:one', '{bad json');
    expect(readCommandRecents('one')).toEqual([]);
    window.localStorage.setItem('eventrunner.adminCommands:one', JSON.stringify([
      { to: 'https://example.test/admin/pages/home', label: 'External' },
      { to: '/admin/attendees/private', label: 'Private' },
      { to: '/admin/pages/home', label: 'Home' },
    ]));
    expect(readCommandRecents('one')).toEqual([{ to: '/admin/pages/home', label: 'Home' }]);
  });
});
