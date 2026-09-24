// The editor tour (issue #198) when its chunk fails to load. A lazy chunk
// can fail on a flaky network or after a deploy replaced it. The shell then
// states that in the tour's place and offers End tour, so "Take the tour"
// never opens nothing. This file mocks the tour module to fail, which is per
// file, so the case is kept apart from AdminLayout.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));
// The chunk that will not load.
vi.mock('./components/AdminTour.jsx', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

import App from '../App.jsx';

beforeEach(() => {
  window.localStorage.clear();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the editor tour when its chunk fails to load', () => {
  it('states the failure in the tour’s place, and End tour closes it and keeps Take the tour', async () => {
    render(
      <MemoryRouter
        initialEntries={['/admin/pages']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
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
  });
});
