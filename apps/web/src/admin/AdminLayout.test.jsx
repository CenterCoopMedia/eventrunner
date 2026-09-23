// The desk's shell (docs/plans/2026-08-27-admin-identity-story.md, amended
// by docs/plans/2026-09-10-admin-editorial-desk.md).
//
// Three things are pinned here, and each one is a rule a reviewer would
// otherwise have to eyeball:
//
//   1. The admin reads the admin-* tokens ONLY. No brand utility survives in
//      the shell chrome — that is the greppable form of "the admin stops
//      mirroring the client theme" (brief §5.2).
//   2. The docket is a grouped standing list of WORDS on the dark rail, not a
//      tab row and not an icon rail, and the current item carries four
//      signals rather than colour alone: the leading-edge marker, the bold
//      weight, the filled ground, and aria-current="page".
//   3. The client's two elements are the job mark and the accent, and
//      nothing else on this surface belongs to the client.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const configSubscriptions = new Map();
vi.mock('../lib/configSource.js', () => ({
  subscribeConfigDoc: (docId, onNext) => {
    configSubscriptions.set(docId, onNext);
    return () => configSubscriptions.delete(docId);
  },
}));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));
vi.mock('./adminSource.js', () => ({
  subscribeAdminCollection: (_name, onNext) => {
    onNext([]);
    return () => {};
  },
}));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next({ uid: 'admin-1', email: 'admin@example.org', getIdToken: async () => 'id-token' });
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../App.jsx';
import { ADMIN_TIERS, DOCKET, TIER_SCOPE, docketForTier, sectionTier, tierReaches } from './AdminLayout.jsx';

async function renderAdmin(path = '/admin/pages') {
  const result = render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // The admin area is a lazy chunk behind Suspense.
  // Two waits, not one: the lazy admin chunk, and then the admin probe the
  // gate holds on (AdminGate renders "Checking your access…" until it
  // answers). Waiting only for the chunk lets an assertion run while the
  // gate is still checking, which is a flake under load, not a bug.
  await waitFor(
    () => {
      expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
    },
    // The admin chunk now pulls the whole public app in with it (the theme
    // editor's frame renders real pages), so the first mount in a file can
    // outrun the default budget on a loaded machine.
    { timeout: 5000 },
  );
  return result;
}

/** The shell chrome only: the docket and its furniture, never the page. */
function shellChrome(container) {
  const room = container.querySelector('.admin-room').cloneNode(true);
  room.querySelector('#admin-content')?.remove();
  return room;
}

beforeEach(() => {
  configSubscriptions.clear();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the admin shell', () => {
  it('reads the admin tokens only — no client brand utility reaches the room', async () => {
    const { container } = await renderAdmin();
    const html = shellChrome(container).innerHTML;

    // The client's palette, the client's faces, and the client's radius.
    expect(html).not.toMatch(/brand-(primary|accent|surface|ink)/);
    expect(html).not.toMatch(/\bfont-(heading|body|data|mono)\b/);
    expect(html).not.toMatch(/rounded-brand/);
    // What it uses instead.
    expect(html).toMatch(/admin-rail-ground/);
    expect(html).toMatch(/font-admin-(ui|data)/);
  });

  it('sets the docket as the Overview and four named groups of words, not a tab row', async () => {
    await renderAdmin();
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });

    // Group heads are folios on a hairline, not headings above a heading.
    // The lead group (the Overview, issue #179) has no label and no folio.
    const folios = [...nav.querySelectorAll('.admin-folio')].map((el) => el.textContent);
    expect(folios).toEqual(DOCKET.filter((group) => group.label).map((group) => group.label));
    expect(folios).toEqual(['Content', 'People', 'Operations', 'System']);
    expect(DOCKET[0]).toMatchObject({ id: 'lead', label: null });
    // The Overview is the first link on the rail.
    expect(nav.querySelector('a')).toHaveTextContent('Overview');
    expect(nav.querySelector('a')).toHaveAttribute('href', '/admin/overview');
    for (const group of DOCKET) {
      for (const item of group.items) {
        // Absolute, so a section reached from another section is not a dead
        // route: a relative `to` resolves against the current location here.
        expect(screen.getByRole('link', { name: item.label })).toHaveAttribute(
          'href',
          `/admin/${item.to}`,
        );
      }
    }
    // One link above the base's sixteen (the Overview, issue #179), every
    // one a word. No icon rail, no glyph-only item.
    expect(nav.querySelectorAll('a')).toHaveLength(17);
    expect(nav.querySelector('svg')).toBeNull();
    for (const link of nav.querySelectorAll('a')) {
      expect(link.textContent.trim().length).toBeGreaterThan(0);
    }
  });

  it('marks the operator’s position with four signals, never colour alone', async () => {
    await renderAdmin('/admin/branding');
    const active = screen.getByRole('link', { name: 'Branding' });

    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active.className).toContain('border-admin-nav-active-marker');
    expect(active.className).toContain('font-bold');
    expect(active.className).toContain('bg-admin-rail-current');

    // And an inactive item carries none of them.
    const inactive = screen.getByRole('link', { name: 'Media' });
    expect(inactive).not.toHaveAttribute('aria-current');
    expect(inactive.className).toContain('border-transparent');
  });

  it('carries the client logo as the job mark: one height, on a paper tile', async () => {
    const { container } = await renderAdmin();
    await act(async () => {
      configSubscriptions.get('theme')({ logos: { mark: 'branding/mark.svg' } });
      await Promise.resolve();
    });
    const mark = shellChrome(container).querySelector('img');

    expect(mark.getAttribute('src')).toBe('/branding/mark.svg');
    // Decorative: the short name beside it is the readable answer to "which
    // deployment am I in".
    expect(mark.getAttribute('alt')).toBe('');
    expect(mark.className).toContain('h-7');
    expect(mark.className).not.toMatch(/border|rounded|shadow/);
    // The tile under it is the one light thing on the rail, and it is a tint
    // on the raised ground — never a shadow.
    expect(mark.parentElement.className).toContain('bg-admin-ground-raised');
    expect(mark.parentElement.className).not.toMatch(/shadow/);
  });

  it('keeps the signed-in identity in the data face', async () => {
    await renderAdmin();
    expect(screen.getByText('admin@example.org').className).toContain('font-admin-data');
  });

  // The tiers (issue #186): one declaration per docket item, read in two
  // places — the rail and the route.
  it('declares a tier on every docket item, and every tier is one the server knows', () => {
    for (const group of DOCKET) {
      for (const item of group.items) {
        expect(ADMIN_TIERS, `${item.to} declares a tier`).toContain(item.tier);
      }
    }
    expect(ADMIN_TIERS).toEqual(['operator', 'staff']);
  });

  it('classifies the sections: content, people and operations are staff; features, branding, access and system errors are operator', () => {
    const byTier = (tier) =>
      DOCKET.flatMap((group) => group.items).filter((item) => item.tier === tier).map((item) => item.to);
    expect(byTier('operator')).toEqual(['features', 'branding', 'access', 'system-errors']);
    expect(byTier('staff')).toEqual([
      'overview',
      'pages', 'sessions', 'content', 'media', 'materials',
      'speakers', 'attendees', 'badges',
      'live-updates', 'ticketing', 'feedback',
      'settings',
    ]);
  });

  it('reads a route’s tier from its docket entry, owning every path under the section', () => {
    expect(sectionTier('/admin/branding')).toBe('operator');
    expect(sectionTier('/admin/overview')).toBe('staff');
    expect(sectionTier('/admin/pages')).toBe('staff');
    expect(sectionTier('/admin/pages/new')).toBe('staff');
    expect(sectionTier('/admin/sessions/abc')).toBe('staff');
    expect(sectionTier('/admin')).toBeNull();
    expect(sectionTier('/admin/')).toBeNull();
  });

  it('normalises the segment the way the router matches it, and fails closed on a path no staff section owns', () => {
    // React Router matches routes case-insensitively, so /admin/Branding
    // renders the Branding page; the tier lookup must see the same section.
    expect(sectionTier('/admin/Branding')).toBe('operator');
    expect(sectionTier('/admin/ACCESS')).toBe('operator');
    expect(sectionTier('/admin/%41ccess')).toBe('operator');
    expect(sectionTier('/admin/Pages/new')).toBe('staff');
    // An /admin path no staff-tier section owns is the operator's — the
    // same default an undeclared docket item takes.
    expect(sectionTier('/admin/nope')).toBe('operator');
    expect(sectionTier('/admin/%E0%A4%A')).toBe('operator');
  });

  it('names each tier’s sections once, in the rail’s own words, Event included for staff', () => {
    const labels = (predicate) =>
      DOCKET.flatMap((group) => group.items).filter(predicate).map((item) => item.label);
    const staffLabels = labels((item) => item.tier === 'staff');
    const operatorLabels = labels((item) => item.tier === 'operator');
    expect(TIER_SCOPE.staff).toBe(
      `${staffLabels.slice(0, -1).join(', ')} and ${staffLabels.at(-1)}`,
    );
    expect(TIER_SCOPE.staff).toContain('Event');
    expect(TIER_SCOPE.operatorOnly).toBe('Features, Branding, Access and System errors');
    expect(operatorLabels).toEqual(['Features', 'Branding', 'Access', 'System errors']);
  });

  it('lets an operator reach everything, staff reach staff only, and an undeclared tier reach nothing but operators', () => {
    expect(tierReaches('operator', 'operator')).toBe(true);
    expect(tierReaches('operator', 'staff')).toBe(true);
    expect(tierReaches('staff', 'staff')).toBe(true);
    expect(tierReaches('staff', 'operator')).toBe(false);
    expect(tierReaches(null, 'staff')).toBe(false);
    // A forgotten declaration closes a section, the same default the
    // server's requireAdmin takes.
    expect(tierReaches('staff', undefined)).toBe(false);
    expect(tierReaches('operator', undefined)).toBe(true);
  });

  it('draws the staff docket without the operator sections and drops an emptied group', () => {
    const staffDocket = docketForTier('staff');
    expect(staffDocket.map((group) => group.id)).toEqual(['lead', 'content', 'people', 'operations', 'system']);
    expect(staffDocket[0].items.map((item) => item.to)).toEqual(['overview']);
    expect(staffDocket.at(-1).items.map((item) => item.to)).toEqual(['settings']);
    expect(docketForTier('operator')).toEqual(DOCKET);
    expect(docketForTier(null)).toEqual([]);
  });

  it('holds the account controls at the control height on every pointer', async () => {
    // The two ways out sit at the foot of the rail and are used constantly.
    // A button holds the control height everywhere (2.75rem), so touch gets
    // its 44px without a coarse-pointer special case.
    await renderAdmin();
    expect(screen.getByRole('link', { name: 'View site' }).className).toContain(
      'min-h-admin-control',
    );
    expect(screen.getByRole('button', { name: 'Sign out' }).className).toContain(
      'min-h-admin-control',
    );
  });
});
