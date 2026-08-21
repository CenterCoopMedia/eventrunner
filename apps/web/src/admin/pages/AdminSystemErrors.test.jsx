// System errors admin surface (issue #58 done-when: an admin can see and
// resolve unresolved system_errors rows). Follows AdminSettings.test.jsx's
// pattern: mount the real App at the admin route, fake `fetch` for the
// listSystemErrors/resolveSystemErrors round trips (there is no Firestore
// listener here — system_errors is server-only).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../../lib/contentSource.js', () => ({ subscribeContentCollection: () => () => {} }));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));
vi.mock('../adminSource.js', () => ({
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

import App from '../../App.jsx';

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}
function urlOf(callIndex) {
  return String(fetch.mock.calls[callIndex][0]);
}
function bodyOf(callIndex) {
  return JSON.parse(fetch.mock.calls[callIndex][1].body);
}

const ROW_OPEN = {
  id: 'e-open-1',
  kind: 'client-error',
  message: 'TypeError: boom',
  errors: null,
  resolved: false,
  alertedAt: null,
  lastSeenAt: 1700000000000,
  createdAt: 1700000000000,
};
const ROW_ALERTED = {
  id: 'e-open-2',
  kind: 'template-override-invalid',
  message: null,
  errors: ['token missing'],
  resolved: false,
  alertedAt: 1700000001000,
  lastSeenAt: 1700000001000,
  createdAt: 1700000001000,
};

async function renderPage() {
  const result = render(
    <MemoryRouter
      initialEntries={['/admin/system-errors']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('system errors list', () => {
  it('loads and shows unresolved rows with kind, message, last-seen, and alert state', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN, ROW_ALERTED], nextCursor: null }));
    await renderPage();

    expect(urlOf(0)).toMatch(/\/listSystemErrors$/);
    expect(await screen.findByText('TypeError: boom')).toBeInTheDocument();
    expect(screen.getByText('token missing')).toBeInTheDocument();
    expect(screen.getByText('client-error')).toBeInTheDocument();
    expect(screen.getByText('Not alerted')).toBeInTheDocument();
    expect(screen.getByText('Alerted')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is unresolved', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [], nextCursor: null }));
    await renderPage();
    expect(await screen.findByText('No unresolved errors')).toBeInTheDocument();
  });

  it('fails soft on a load error: a status notice, no crash', async () => {
    fetch.mockRejectedValueOnce(new Error('network down'));
    await renderPage();
    expect(await screen.findByRole('status', { name: '' })).toBeTruthy();
    expect(
      screen.getByText(/could not refresh the error list/i),
    ).toBeInTheDocument();
  });
});

describe('resolving a row', () => {
  it('resolves a row and removes it from the unresolved list', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN], nextCursor: null }));
    await renderPage();
    await screen.findByText('TypeError: boom');

    fetch.mockResolvedValueOnce(okResponse({ id: 'e-open-1', resolved: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(1)).toMatch(/\/resolveSystemErrors$/);
    expect(bodyOf(1)).toEqual({ id: 'e-open-1', expectedLastSeenAt: ROW_OPEN.lastSeenAt });

    await waitFor(() => expect(screen.queryByText('TypeError: boom')).toBeNull());
    expect(await screen.findByText('No unresolved errors')).toBeInTheDocument();
  });

  it('reports a reopen race instead of pretending the resolve worked', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN], nextCursor: null }));
    await renderPage();
    await screen.findByText('TypeError: boom');

    fetch.mockResolvedValueOnce(okResponse({ id: 'e-open-1', resolved: false, reopened: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/recurred since the list loaded/i);
    // The row stays visible — it was NOT actually resolved.
    expect(screen.getByText('TypeError: boom')).toBeInTheDocument();
  });

  it('surfaces a server rejection against the row it came from', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN], nextCursor: null }));
    await renderPage();
    await screen.findByText('TypeError: boom');

    fetch.mockResolvedValueOnce(errorResponse(404, 'not-found', 'system_errors/e-open-1 does not exist.'));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('does not exist');
  });
});
