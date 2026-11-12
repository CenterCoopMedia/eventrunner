// The editor tour (issue #198) when its chunk fails to load. A lazy chunk
// can fail on a flaky network or after a deploy replaced it. The shell then
// states that in the tour's place and offers End tour, so "Take the tour"
// never opens nothing. This file mocks the tour module to fail, which is per
// file, so the case is kept apart from AdminLayout.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { installChunkReload } from '../lib/chunkReload.js';
import { isRoutePrefetchPending, routePage } from '../lib/routePage.jsx';

const recovery = vi.hoisted(() => ({ reload: vi.fn(), events: [] }));
vi.mock('../lib/chunkReload.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, reloadOnce: (options = {}) => actual.reloadOnce({ ...options, reload: recovery.reload }) };
});

vi.mock('../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
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
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));
// The chunk that will not load.
vi.mock('./components/AdminTour.jsx', () => {
  const error = new Error('Failed to fetch dynamically imported module');
  const event = new Event('vite:preloadError', { cancelable: true });
  event.payload = error;
  recovery.events.push(event);
  window.dispatchEvent(event);
  if (!event.defaultPrevented) throw error;
  return { default: () => null };
});

import App from '../App.jsx';

beforeEach(() => {
  window.localStorage.clear();
  sessionStorage.clear();
  recovery.reload.mockClear();
  recovery.events.length = 0;
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the editor tour when its chunk fails to load', () => {
  it('states the failure in the tour’s place, and End tour closes it and keeps Take the tour', async () => {
    let finish;
    const pending = routePage(() => new Promise((resolve) => { finish = resolve; }));
    const speculation = pending.prefetch();
    const removeListener = installChunkReload(window, { reload: recovery.reload, isPrefetching: isRoutePrefetchPending });
    try {
      render(
        <MemoryRouter
          initialEntries={['/admin/pages']}
        >
          <App />
        </MemoryRouter>,
      );
      await act(async () => {
        await Promise.resolve();
      });
      const tour = await screen.findByRole('complementary', { name: 'Admin tour' }, { timeout: 5000 });
      expect(within(tour).getByRole('status')).toHaveTextContent(
        'The tour did not load. Reload the page to try again.',
      );
      expect(recovery.events).toHaveLength(1);
      expect(recovery.events[0].defaultPrevented).toBe(false);
      expect(recovery.reload).toHaveBeenCalledTimes(1);
      fireEvent.click(within(tour).getByRole('button', { name: 'End tour' }));
      expect(screen.queryByRole('complementary', { name: 'Admin tour' })).toBeNull();
      const takeTour = screen.getByRole('button', { name: 'Take the tour' });
      expect(takeTour).toHaveFocus();

      // Asked for again, it says the same thing rather than nothing.
      fireEvent.click(takeTour);
      await waitFor(() =>
        expect(screen.getByRole('complementary', { name: 'Admin tour' })).toHaveTextContent(
          'The tour did not load.',
        ),
      );
      expect(recovery.reload).toHaveBeenCalledTimes(1);
    } finally {
      removeListener();
      finish({ default: () => null });
      await speculation;
      sessionStorage.clear();
    }
  });
});
