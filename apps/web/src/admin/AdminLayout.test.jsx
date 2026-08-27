// The composing room's shell (docs/plans/2026-08-27-admin-identity-story.md).
//
// Three things are pinned here, and each one is a rule a reviewer would
// otherwise have to eyeball:
//
//   1. The admin reads the admin-* tokens ONLY. No brand utility survives in
//      the shell chrome — that is the greppable form of "the admin stops
//      mirroring the client theme" (brief §5.2).
//   2. The docket is a grouped standing list of WORDS, not a tab row and not
//      an icon rail, and the active item carries four signals rather than
//      colour alone: the accent marker, the semibold weight, a ground shift,
//      and aria-current="page".
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
import { DOCKET } from './AdminLayout.jsx';

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
      expect(screen.queryByLabelText('Loading admin')).not.toBeInTheDocument();
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
    expect(html).toMatch(/admin-ground/);
    expect(html).toMatch(/font-admin-(ui|data)/);
  });

  it('sets the docket as four named groups of words, not a tab row', async () => {
    await renderAdmin();
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });

    // Group heads are folios on a hairline, not headings above a heading.
    const folios = [...nav.querySelectorAll('.admin-folio')].map((el) => el.textContent);
    expect(folios).toEqual(DOCKET.map((group) => group.label));
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
    // Fourteen sections, every one a word. No icon rail, no glyph-only item.
    expect(nav.querySelectorAll('a')).toHaveLength(14);
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
    expect(active.className).toContain('font-semibold');
    expect(active.className).toContain('bg-admin-ground-raised');

    // And an inactive item carries none of them.
    const inactive = screen.getByRole('link', { name: 'Media' });
    expect(inactive).not.toHaveAttribute('aria-current');
    expect(inactive.className).toContain('border-transparent');
  });

  it('carries the client logo as the job mark: one height, no frame', async () => {
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
  });

  it('keeps the signed-in identity in the data face', async () => {
    await renderAdmin();
    expect(screen.getByText('admin@example.org').className).toContain('font-admin-data');
  });
});
