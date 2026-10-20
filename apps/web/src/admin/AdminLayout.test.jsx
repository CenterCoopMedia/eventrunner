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
//      weight, the filled ground, and aria-current="page". Its groups fold,
//      and the whole rail hides on a wide screen (issue #477).
//   3. The client's two elements are the job mark and the accent, and
//      nothing else on this surface belongs to the client.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

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
// The signed-in account. The tour's stored mark is per account, so the one
// test that ends it with a refusing store signs in as its own account.
let signedInUid = 'admin-1';
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next({ uid: signedInUid, email: 'admin@example.org', getIdToken: async () => 'id-token' });
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../App.jsx';
import {
  ADMIN_DESKTOP_VIEWPORT,
  ADMIN_TIERS,
  DOCKET,
  TIER_SCOPE,
  activeGroupId,
  choicesOnArrival,
  docketForTier,
  docketGroupOpen,
  sectionTier,
  tierReaches,
} from './AdminLayout.jsx';
import {
  DOCKET_GROUPS_KEY,
  RAIL_COLLAPSED_KEY,
  forgetLayoutMemory,
} from './layoutPreference.js';
// Mocked for every file in src/test/setup.js; steered here for the banner.
import { subscribePendingCounts } from './pendingCountsSource.js';
import { markTourDone, readTourDone } from './tourState.js';

async function renderAdmin(path = '/admin/pages') {
  const result = render(
    <MemoryRouter
      initialEntries={[path]}
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

/** Open every closed docket group, so each link can be reached by role. */
function openEveryGroup() {
  for (const head of document.querySelectorAll('.admin-docket-group-toggle[aria-expanded="false"]')) {
    fireEvent.click(head);
  }
}

beforeEach(() => {
  configSubscriptions.clear();
  window.localStorage.removeItem(RAIL_COLLAPSED_KEY);
  window.localStorage.removeItem(DOCKET_GROUPS_KEY);
  forgetLayoutMemory();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the admin shell', () => {
  it('opens the docket at the same pixel breakpoint that hides Menu', () => {
    expect(ADMIN_DESKTOP_VIEWPORT).toBe('(min-width: 1024px)');
  });

  it('names the current section for case-insensitive and encoded admin routes', async () => {
    for (const path of ['/admin/Pages', '/admin/%50ages', '/Admin/pages', '/%41dmin/pages']) {
      const { container, unmount } = await renderAdmin(path);
      const summary = container.querySelector('details.admin-mobile-docket > summary');
      expect(within(summary).getByText('Pages')).toHaveAttribute('title', 'Pages');
      unmount();
    }
  });

  it('uses one compact phone bar and a full-width grouped menu sheet', async () => {
    const original = window.matchMedia;
    const originalBodyOverflow = document.body.style.overflow;
    let desktop = false;
    const desktopListeners = new Set();
    window.matchMedia = vi.fn((query) => ({
      get matches() {
        return query === ADMIN_DESKTOP_VIEWPORT ? desktop : false;
      },
      addEventListener: (type, listener) => {
        if (query === ADMIN_DESKTOP_VIEWPORT && type === 'change') desktopListeners.add(listener);
      },
      removeEventListener: (type, listener) => {
        if (type === 'change') desktopListeners.delete(listener);
      },
    }));
    const setDesktop = (next) => {
      desktop = next;
      act(() => {
        desktopListeners.forEach((listener) => listener({ matches: next }));
      });
    };
    try {
      const { container } = await renderAdmin('/admin/pages');
      const rail = container.querySelector('.admin-rail');
      const docket = rail.querySelector('details.admin-mobile-docket');
      const summary = docket.querySelector('summary');
      const sheet = docket.querySelector('.admin-mobile-docket__content');
      const nav = within(docket).getByRole('navigation', { name: 'Admin sections' });

      expect(rail.className).toContain('min-h-14');
      expect(rail.className).toContain('flex-wrap');
      expect(within(rail).getByText('NC Local')).toBeInTheDocument();
      expect(within(summary).getByText('Pages')).toBeInTheDocument();
      expect(within(summary).getByText('Menu')).toBeInTheDocument();
      expect(docket).not.toHaveAttribute('open');
      expect(sheet.className).toMatch(/\bfixed\b/);
      expect(sheet.className).toContain('top-14');
      expect(sheet.className).toContain('bottom-0');

      for (const group of nav.children) {
        expect(group.className).not.toContain('flex-wrap');
      }
      for (const list of nav.querySelectorAll('ul')) {
        expect(list.className).toContain('flex-col');
      }
      for (const link of nav.querySelectorAll('a')) {
        expect(link.parentElement.className).toContain('w-full');
        expect(link.className).toContain('w-full');
        expect(link.className).toContain('min-h-admin-control');
      }
      expect(docket).toContainElement(screen.getByText('admin@example.org'));
      expect(docket).toContainElement(screen.getByRole('button', { name: 'Sign out' }));

      // Stand in for an already-open media dialog, which owns body overflow.
      document.body.style.overflow = 'hidden';
      fireEvent.click(summary);
      expect(docket).toHaveAttribute('open');
      await waitFor(() =>
        expect(container.querySelector('#admin-content')).toHaveAttribute('inert'),
      );
      // The scroll lock is applied in an effect after the sheet opens.
      await waitFor(() => expect(document.documentElement.style.overflow).toBe('hidden'));
      // A media dialog owns body overflow. If it closes while this sheet is
      // open, closing the sheet must not restore the dialog's stale lock.
      document.body.style.overflow = '';
      fireEvent.click(summary);
      await waitFor(() => expect(document.documentElement.style.overflow).toBe(''));
      expect(document.body.style.overflow).toBe('');

      fireEvent.click(summary);
      await waitFor(() => expect(document.documentElement.style.overflow).toBe('hidden'));
      const pagesLink = within(nav).getByRole('link', { name: 'Pages' });
      pagesLink.focus();
      fireEvent.click(pagesLink);
      await waitFor(() => expect(docket).not.toHaveAttribute('open'));
      expect(summary).toHaveFocus();

      fireEvent.click(summary);
      await waitFor(() => expect(docket).toHaveAttribute('open'));
      await waitFor(() => expect(container.querySelector('#admin-content')).toHaveAttribute('inert'));
      // Sessions is under Program, which a reader on Pages has not opened.
      fireEvent.click(within(nav).getByRole('button', { name: 'Program' }));
      const sessions = within(nav).getByRole('link', { name: 'Sessions' });
      sessions.focus();
      fireEvent.keyDown(sessions, { key: 'Tab' });
      fireEvent.keyDown(sessions, { key: 'Tab', shiftKey: true });
      expect(docket).toHaveAttribute('open');
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      const dialogButton = document.createElement('button');
      dialogButton.type = 'button';
      dialogButton.textContent = 'Close detail';
      dialog.append(dialogButton);
      document.body.append(dialog);
      dialogButton.focus();
      fireEvent.keyDown(dialogButton, { key: 'Escape' });
      expect(docket).toHaveAttribute('open');
      dialog.remove();
      sessions.focus();
      fireEvent.keyDown(sessions, { key: 'Escape' });
      await waitFor(() => expect(docket).not.toHaveAttribute('open'));
      expect(summary).toHaveFocus();
      expect(container.querySelector('#admin-content')).not.toHaveAttribute('inert');
      await waitFor(() => expect(document.documentElement.style.overflow).toBe(''));
      fireEvent.click(summary);
      await waitFor(() => expect(document.documentElement.style.overflow).toBe('hidden'));
      fireEvent.keyDown(summary, { key: 'Escape' });
      await waitFor(() => expect(docket).not.toHaveAttribute('open'));
      expect(summary).toHaveFocus();

      fireEvent.click(sessions);
      await waitFor(() => expect(docket).not.toHaveAttribute('open'));
      expect(summary).toHaveFocus();
      expect(within(summary).getByText('Sessions')).toBeInTheDocument();
      fireEvent.click(summary);
      await waitFor(() => expect(docket).toHaveAttribute('open'));
      setDesktop(true);
      await waitFor(() => expect(document.documentElement.style.overflow).toBe(''));
      expect(container.querySelector('#admin-content')).not.toHaveAttribute('inert');
      expect(docket).toHaveAttribute('open');
      fireEvent.keyDown(summary, { key: 'Escape' });
      expect(docket).toHaveAttribute('open');
      setDesktop(false);
      await waitFor(() => expect(document.documentElement.style.overflow).toBe('hidden'));
      expect(container.querySelector('#admin-content')).toHaveAttribute('inert');
      fireEvent.keyDown(summary, { key: 'Escape' });
      await waitFor(() => expect(docket).not.toHaveAttribute('open'));
      expect(summary).toHaveFocus();
      expect(document.documentElement.style.overflow).toBe('');
    } finally {
      document.body.style.overflow = originalBodyOverflow;
      if (original) window.matchMedia = original;
      else delete window.matchMedia;
    }
  });

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

  it('sets the docket as the Overview and six named groups of words, not a tab row', async () => {
    await renderAdmin();
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    openEveryGroup();

    // Group heads are folios on a hairline, not headings above a heading.
    // The lead group (the Overview, issue #179) has no label and no folio.
    const folios = [...nav.querySelectorAll('.admin-folio')].map((el) => el.textContent);
    expect(folios).toEqual(DOCKET.filter((group) => group.label).map((group) => group.label));
    expect(folios).toEqual([
      'Content',
      'Program',
      'Registration and tickets',
      'Communications',
      'Operations',
      'Settings',
    ]);
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
    // Nine links above the base's sixteen (the Overview, issue #179, the
    // Email log, issue #183, Change requests, issue #188, Organizations,
    // issue #192, Updates, issue #190, Timeline, issue #194, Version history,
    // issue #195, Unpublished changes, issue #196, and Announcements,
    // issue #199), Import records, and Data export, issue #329, every one a word. No
    // icon rail, no glyph-only item.
    expect(nav.querySelectorAll('a')).toHaveLength(28);
    expect(screen.getByRole('link', { name: 'Updates' })).toHaveAttribute('href', '/admin/updates');
    expect(screen.getByRole('link', { name: 'Unpublished changes' })).toHaveAttribute(
      'href',
      '/admin/unpublished',
    );
    expect(nav.querySelector('svg')).toBeNull();
    expect(nav.querySelector('img')).toBeNull();
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
    openEveryGroup();
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

  it('classifies the sections: every group but Settings is staff; features, branding, access and system errors are operator', () => {
    const byTier = (tier) =>
      DOCKET.flatMap((group) => group.items).filter((item) => item.tier === tier).map((item) => item.to);
    expect(byTier('operator')).toEqual(['features', 'branding', 'access', 'system-errors']);
    expect(byTier('staff')).toEqual([
      'overview',
      'pages', 'content', 'updates', 'timeline', 'media', 'materials', 'versions', 'unpublished',
      'sessions', 'pitches', 'speakers', 'organizations',
      'attendees', 'ticketing', 'badges',
      'announcements', 'live-updates', 'email-log',
      'import', 'feedback', 'change-requests', 'data-export',
      'settings',
    ]);
  });

  it('reads a route’s tier from its docket entry, owning every path under the section', () => {
    expect(sectionTier('/admin/branding')).toBe('operator');
    expect(sectionTier('/admin/overview')).toBe('staff');
    expect(sectionTier('/admin/pages')).toBe('staff');
    expect(sectionTier('/admin/announcements')).toBe('staff');
    // The email log is staff visible (issue #183).
    expect(sectionTier('/admin/email-log')).toBe('staff');
    // Change requests are staff work (issue #188). An undeclared item would
    // fall to the operator and lock staff out of their own queue.
    expect(sectionTier('/admin/change-requests')).toBe('staff');
    // So is the record import: it writes drafts through the editors' validators.
    expect(sectionTier('/admin/import')).toBe('staff');
    // Version history is staff work, the record route under it too (issue #195).
    expect(sectionTier('/admin/versions')).toBe('staff');
    expect(sectionTier('/admin/versions/cmsContent/x')).toBe('staff');
    // So is the list of unpublished changes (issue #196).
    expect(sectionTier('/admin/unpublished')).toBe('staff');
    expect(sectionTier('/admin/pages/new')).toBe('staff');
    expect(sectionTier('/admin/sessions/abc')).toBe('staff');
    // The organizations list and editor are content, so staff work (#192).
    expect(sectionTier('/admin/organizations')).toBe('staff');
    expect(sectionTier('/admin/organizations/new/organization')).toBe('staff');
    // Updates is content work (issue #190), its editors included.
    expect(sectionTier('/admin/updates')).toBe('staff');
    expect(sectionTier('/admin/updates/new/update')).toBe('staff');
    // The timeline list and editor are content, so staff work (#194).
    expect(sectionTier('/admin/timeline')).toBe('staff');
    expect(sectionTier('/admin/timeline/new/entry')).toBe('staff');
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
    // The PREFIX matches case-insensitively and decoded too, so it is read
    // the same way — the whole pathname is normalised, not one segment.
    expect(sectionTier('/Admin/branding')).toBe('operator');
    expect(sectionTier('/ADMIN/Branding')).toBe('operator');
    expect(sectionTier('/%41dmin/%42randing')).toBe('operator');
    expect(sectionTier('/Admin/pages')).toBe('staff');
    expect(sectionTier('/Admin')).toBeNull();
    // A segment that decodes to a slash, or an empty segment before more
    // path, is nothing the docket owns: the operator's.
    expect(sectionTier('/admin/%2Fbranding')).toBe('operator');
    expect(sectionTier('/admin//branding')).toBe('operator');
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
    expect(staffDocket.map((group) => group.id)).toEqual([
      'lead',
      'content',
      'program',
      'registration',
      'communications',
      'operations',
      'settings',
    ]);
    expect(staffDocket[0].items.map((item) => item.to)).toEqual(['overview']);
    expect(staffDocket.at(-1).items.map((item) => item.to)).toEqual(['settings']);
    expect(docketForTier('operator')).toEqual(DOCKET);
    expect(docketForTier(null)).toEqual([]);
  });

  // The pending-changes banner (issue #196) sits above the stone, never
  // inside it: the title band pulls itself up by the stone's top padding
  // and would slide over anything placed before it there.
  it('puts the unpublished changes banner first in main, outside the stone', async () => {
    vi.mocked(subscribePendingCounts).mockImplementation((_initialize, onNext) => {
      onNext({ cmsContent: 1, cmsPages: 0, cmsSchedule: 0, cmsOrganizations: 0, cmsUpdates: 0, cmsTimeline: 0 });
      return () => {};
    });
    try {
      const { container } = await renderAdmin('/admin/pages');
      const banner = await screen.findByRole('complementary', { name: 'Unpublished changes' });
      const main = container.querySelector('main#admin-content');
      expect(main.firstElementChild.contains(banner)).toBe(true);
      expect(banner.closest('.admin-stone')).toBeNull();
      expect(main.firstElementChild.nextElementSibling).toHaveClass('admin-stone');
      expect(banner).toHaveAttribute('data-pending-total', '1');
      expect(banner).toHaveTextContent('1 unpublished change: 1 content block.');
      // The rail carries words only: no count joins the docket link.
      expect(screen.getByRole('link', { name: 'Unpublished changes' })).toHaveTextContent(/^Unpublished changes$/);
    } finally {
      vi.mocked(subscribePendingCounts).mockImplementation((_initialize, onNext) => {
        onNext({ cmsContent: 0, cmsPages: 0, cmsSchedule: 0, cmsOrganizations: 0, cmsUpdates: 0, cmsTimeline: 0 });
        return () => {};
      });
    }
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

// The editor tour (issue #198) is shell chrome: it opens on a first visit,
// sits inside the stone above the page, and ends from any step.
describe('the editor tour in the shell', () => {
  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  const tourPanel = () => screen.findByRole('complementary', { name: 'Admin tour' });
  // The tour is a lazy chunk. Before asserting it is ABSENT, let that chunk
  // load, so an open tour would have had every chance to draw.
  const settleTourChunk = () =>
    act(async () => {
      await import('./components/AdminTour.jsx');
      await Promise.resolve();
    });

  beforeEach(() => {
    window.localStorage.clear();
    signedInUid = 'admin-1';
  });

  it('opens on a first visit inside the stone, above the page heading, without taking the focus', async () => {
    const { container } = await renderAdmin('/admin/pages');
    const tour = await tourPanel();
    // After the unpublished changes banner's place (outside the stone) and
    // before the page: the first thing in the stone.
    expect(container.querySelector('.admin-stone').firstElementChild).toBe(tour);
    const heading = within(tour).getByRole('heading', { level: 2, name: 'Welcome to the admin panel' });
    // An operator reaches seven groups: a welcome, seven steps, and the last.
    const stepLine = within(tour).getByText('Step 1 of 9');
    expect(heading.compareDocumentPosition(stepLine) & FOLLOWING).toBeTruthy();
    const pageHeading = await screen.findByRole('heading', { level: 1, name: 'Pages' });
    expect(tour.compareDocumentPosition(pageHeading) & FOLLOWING).toBeTruthy();
    expect(heading).not.toHaveFocus();
  });

  it('stays closed for an account that has ended it in this browser', async () => {
    markTourDone('admin-1');
    await renderAdmin('/admin/pages');
    await screen.findByRole('heading', { level: 1, name: 'Pages' });
    await settleTourChunk();
    expect(screen.queryByRole('complementary', { name: 'Admin tour' })).toBeNull();
  });

  it('ends from End tour: it stores the mark, closes, and gives the focus to Take the tour', async () => {
    await renderAdmin('/admin/pages');
    const tour = await tourPanel();
    fireEvent.click(within(tour).getByRole('button', { name: 'End tour' }));
    expect(screen.queryByRole('complementary', { name: 'Admin tour' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Take the tour' })).toHaveFocus();
    expect(readTourDone('admin-1')).toBe(true);
  });

  it('returns focus to the visible Menu when a first phone tour ends with the docket closed', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    try {
      await renderAdmin('/admin/pages');
      const tour = await tourPanel();
      const menu = screen.getByText('Menu').closest('summary');
      expect(menu.closest('details')).not.toHaveAttribute('open');

      fireEvent.click(within(tour).getByRole('button', { name: 'End tour' }));

      expect(screen.queryByRole('complementary', { name: 'Admin tour' })).toBeNull();
      expect(menu).toHaveFocus();
      expect(readTourDone('admin-1')).toBe(true);
    } finally {
      if (original) window.matchMedia = original;
      else delete window.matchMedia;
    }
  });

  it('closes the phone menu before opening the tour, then returns focus to Menu', async () => {
    markTourDone('admin-1');
    await renderAdmin('/admin/pages');
    const menu = screen.getByText('Menu').closest('summary');
    const docket = menu.closest('details');
    docket.open = true;
    fireEvent(docket, new Event('toggle'));
    await waitFor(() => expect(docket).toHaveAttribute('open'));
    await waitFor(() =>
      expect(document.querySelector('#admin-content')).toHaveAttribute('inert'),
    );
    const takeTour = screen.getByRole('button', { name: 'Take the tour' });
    // First in the rail foot's button row, and a rail control like its neighbours.
    expect(takeTour.parentElement.firstElementChild).toBe(takeTour);
    expect(takeTour.className).toContain('min-h-admin-control');
    fireEvent.click(takeTour);
    expect(docket).not.toHaveAttribute('open');
    expect(document.querySelector('#admin-content')).not.toHaveAttribute('inert');
    const heading = await screen.findByRole('heading', { level: 2, name: 'Welcome to the admin panel' });
    await waitFor(() => expect(heading).toHaveFocus());
    fireEvent.keyDown(heading, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Admin tour' })).toBeNull();
    expect(menu).toHaveFocus();
  });

  it('stays on screen, at its step, while the reader opens the section it names', async () => {
    await renderAdmin('/admin/pages');
    const tour = await tourPanel();
    fireEvent.click(within(tour).getByRole('button', { name: 'Next' }));
    expect(within(tour).getByText('Step 2 of 9')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Content' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Content' })).toBeInTheDocument();
    expect(within(await tourPanel()).getByText('Step 2 of 9')).toBeInTheDocument();
  });

  it('still ends, for the life of the tab, when the browser refuses its store', async () => {
    signedInUid = 'admin-refused-store';
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const first = await renderAdmin('/admin/pages');
      const tour = await tourPanel();
      fireEvent.click(within(tour).getByRole('button', { name: 'End tour' }));
      expect(screen.queryByRole('complementary', { name: 'Admin tour' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Take the tour' })).toHaveFocus();
      first.unmount();

      // A fresh shell in the same tab (the reader went to the site and back).
      await renderAdmin('/admin/pages');
      await screen.findByRole('heading', { level: 1, name: 'Pages' });
      await settleTourChunk();
      expect(screen.queryByRole('complementary', { name: 'Admin tour' })).toBeNull();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe('folding groups and the hiding rail, issue 477', () => {
  /** A wide screen: every min-width query matches. */
  const wideScreen = () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn((query) => ({
      matches: /min-width/.test(query),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    return () => {
      if (original) window.matchMedia = original;
      else delete window.matchMedia;
    };
  };
  const head = (name) =>
    within(screen.getByRole('navigation', { name: 'Admin sections' })).getByRole('button', { name });
  const storedGroups = () => JSON.parse(window.localStorage.getItem(DOCKET_GROUPS_KEY) ?? '{}');

  beforeEach(() => {
    signedInUid = 'admin-1';
    markTourDone('admin-1');
  });

  it('names the group that holds a section, and none for a path no section owns', () => {
    expect(activeGroupId(DOCKET, '/admin/pages/new')).toBe('content');
    expect(activeGroupId(DOCKET, '/admin/Sessions')).toBe('program');
    expect(activeGroupId(DOCKET, '/admin/ticketing')).toBe('registration');
    expect(activeGroupId(DOCKET, '/admin/email-log')).toBe('communications');
    expect(activeGroupId(DOCKET, '/admin/data-export')).toBe('operations');
    expect(activeGroupId(DOCKET, '/admin/branding')).toBe('settings');
    expect(activeGroupId(DOCKET, '/admin/overview')).toBe('lead');
    expect(activeGroupId(DOCKET, '/admin/nope')).toBeNull();
    // A staff docket has no Branding item, so the refused route opens nothing.
    expect(activeGroupId(docketForTier('staff'), '/admin/settings')).toBe('settings');
    expect(activeGroupId(docketForTier('staff'), '/admin/branding')).toBeNull();
  });

  it('opens a group by the reader’s choice first, then for the current page or one visited', () => {
    const content = DOCKET.find((group) => group.id === 'content');
    const lead = DOCKET[0];
    const none = { choices: {}, visited: new Set(), activeId: null };
    expect(docketGroupOpen(lead, none)).toBe(true);
    expect(docketGroupOpen(content, none)).toBe(false);
    expect(docketGroupOpen(content, { ...none, activeId: 'content' })).toBe(true);
    expect(docketGroupOpen(content, { ...none, visited: new Set(['content']) })).toBe(true);
    expect(docketGroupOpen(content, { ...none, choices: { content: true } })).toBe(true);
    expect(docketGroupOpen(content, { ...none, choices: { content: false }, activeId: 'content' })).toBe(false);
  });

  it('drops a closed choice for the group a reader arrives in, and keeps every other choice', () => {
    const choices = { content: false, program: true, settings: false };
    expect(choicesOnArrival(choices, 'content')).toEqual({ program: true, settings: false });
    expect(choicesOnArrival(choices, 'program')).toBe(choices);
    expect(choicesOnArrival(choices, null)).toBe(choices);
  });

  it('folds each group behind a real button, with the current page’s group open', async () => {
    await renderAdmin('/admin/branding');
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    // The Overview has no head and is always there.
    expect(within(nav).getByRole('link', { name: 'Overview' })).toBeVisible();
    for (const group of DOCKET.filter((entry) => entry.label)) {
      const button = head(group.label);
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      const list = document.getElementById(button.getAttribute('aria-controls'));
      expect(list.tagName).toBe('UL');
      const open = group.id === 'settings';
      expect(button).toHaveAttribute('aria-expanded', String(open));
      if (open) expect(list).not.toHaveAttribute('hidden');
      else expect(list).toHaveAttribute('hidden');
    }
    expect(within(nav).getByRole('link', { name: 'Branding' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: 'Pages' })).toBeNull();

    // Opening a group is a press of its head, by pointer or by keyboard.
    const content = head('Content');
    content.focus();
    fireEvent.click(content);
    expect(content).toHaveAttribute('aria-expanded', 'true');
    expect(content).toHaveFocus();
    expect(within(nav).getByRole('link', { name: 'Pages' })).toBeInTheDocument();
    expect(storedGroups()).toEqual({ content: true });
  });

  it('names the current page in the head when the reader closes its group', async () => {
    await renderAdmin('/admin/branding');
    const settings = head('Settings');
    fireEvent.click(settings);
    expect(settings).toHaveAttribute('aria-expanded', 'false');
    // jsdom spaces the hidden phrase off from the word; a browser does not.
    expect(settings).toHaveAccessibleName(/^Settings ?, current page: Branding$/);
    expect(screen.queryByRole('link', { name: 'Branding' })).toBeNull();
    expect(storedGroups()).toEqual({ settings: false });
    // Nothing about the route changed.
    expect(screen.getByRole('heading', { level: 1, name: 'Branding' })).toBeInTheDocument();
  });

  it('opens the group a navigation lands in, and keeps a visited group open', async () => {
    vi.mocked(subscribePendingCounts).mockImplementation((_initialize, onNext) => {
      onNext({ cmsContent: 1, cmsPages: 0, cmsSchedule: 0, cmsOrganizations: 0, cmsUpdates: 0, cmsTimeline: 0 });
      return () => {};
    });
    window.localStorage.setItem(DOCKET_GROUPS_KEY, JSON.stringify({ content: false, program: true }));
    try {
      await renderAdmin('/admin/branding');
      expect(head('Content')).toHaveAttribute('aria-expanded', 'false');
      expect(head('Program')).toHaveAttribute('aria-expanded', 'true');
      // The banner's link leads into Content, a group the reader closed.
      const banner = await screen.findByRole('complementary', { name: 'Unpublished changes' });
      fireEvent.click(within(banner).getByRole('link'));
      await screen.findByRole('heading', { level: 1, name: 'Unpublished changes' });
      await waitFor(() => expect(head('Content')).toHaveAttribute('aria-expanded', 'true'));
      expect(screen.getByRole('link', { name: 'Unpublished changes' })).toHaveAttribute('aria-current', 'page');
      // Settings held the page before; it stays open rather than folding
      // up under the pointer.
      expect(head('Settings')).toHaveAttribute('aria-expanded', 'true');
      expect(head('Program')).toHaveAttribute('aria-expanded', 'true');
      expect(storedGroups()).toEqual({ program: true });
    } finally {
      vi.mocked(subscribePendingCounts).mockImplementation((_initialize, onNext) => {
        onNext({ cmsContent: 0, cmsPages: 0, cmsSchedule: 0, cmsOrganizations: 0, cmsUpdates: 0, cmsTimeline: 0 });
        return () => {};
      });
    }
  });

  it('remembers the open groups in this browser', async () => {
    const first = await renderAdmin('/admin/branding');
    fireEvent.click(head('Communications'));
    first.unmount();
    forgetLayoutMemory();
    await renderAdmin('/admin/branding');
    expect(head('Communications')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Content')).toHaveAttribute('aria-expanded', 'false');
  });

  it('still folds, for the life of the tab, when the browser refuses its store', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const first = await renderAdmin('/admin/branding');
      fireEvent.click(head('Program'));
      expect(head('Program')).toHaveAttribute('aria-expanded', 'true');
      first.unmount();
      await renderAdmin('/admin/branding');
      expect(head('Program')).toHaveAttribute('aria-expanded', 'true');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('offers no rail toggle on a phone, where Menu does that work', async () => {
    await renderAdmin('/admin/pages');
    expect(screen.queryByRole('button', { name: 'Hide menu' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show menu' })).toBeNull();
  });

  it('hides the rail on a wide screen from one button that keeps the focus and the route', async () => {
    const restore = wideScreen();
    try {
      const { container } = await renderAdmin('/admin/branding');
      const rail = container.querySelector('.admin-rail');
      const toggle = screen.getByRole('button', { name: 'Hide menu' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAttribute('aria-controls', 'admin-docket');
      const docket = document.getElementById('admin-docket');
      expect(docket).toContainElement(screen.getByRole('navigation', { name: 'Admin sections' }));
      // The first control after the skip link, so the keyboard reaches it at once.
      const focusables = [...container.querySelectorAll('a[href], button, summary')];
      expect(focusables[0]).toHaveClass('skip-link');
      expect(focusables[1]).toBe(toggle);

      toggle.focus();
      fireEvent.click(toggle);
      expect(toggle).toHaveAccessibleName('Show menu');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveFocus();
      expect(docket).toHaveAttribute('hidden');
      expect(screen.queryByRole('navigation', { name: 'Admin sections' })).toBeNull();
      expect(rail).toHaveAttribute('data-collapsed', 'true');
      expect(window.localStorage.getItem(RAIL_COLLAPSED_KEY)).toBe('true');
      // The page, its route and its heading are untouched.
      expect(screen.getByRole('heading', { level: 1, name: 'Branding' })).toBeInTheDocument();

      fireEvent.click(toggle);
      expect(toggle).toHaveAccessibleName('Hide menu');
      expect(docket).not.toHaveAttribute('hidden');
      expect(screen.getByRole('link', { name: 'Branding' })).toHaveAttribute('aria-current', 'page');
      expect(rail).not.toHaveAttribute('data-collapsed');
      expect(window.localStorage.getItem(RAIL_COLLAPSED_KEY)).toBe('false');
    } finally {
      restore();
    }
  });

  it('opens hidden when this browser remembers a hidden rail, and ends the tour on Show menu', async () => {
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, 'true');
    window.localStorage.removeItem('eventrunner.adminTour.v1:admin-1');
    const restore = wideScreen();
    try {
      await renderAdmin('/admin/pages');
      const toggle = screen.getByRole('button', { name: 'Show menu' });
      expect(document.getElementById('admin-docket')).toHaveAttribute('hidden');
      const tour = await screen.findByRole('complementary', { name: 'Admin tour' });
      fireEvent.click(within(tour).getByRole('button', { name: 'End tour' }));
      expect(toggle).toHaveFocus();
    } finally {
      restore();
    }
  });
});
