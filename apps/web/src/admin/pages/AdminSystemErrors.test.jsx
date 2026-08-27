// System errors admin surface (issue #58 done-when: an admin can see and
// resolve unresolved system_errors rows). Follows AdminSettings.test.jsx's
// pattern: mount the real App at the admin route, fake `fetch` for the
// listSystemErrors/resolveSystemErrors round trips (there is no Firestore
// listener here — system_errors is server-only).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
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

beforeEach(() => {
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('system errors list', () => {
  it('loads and shows unresolved rows with kind, message, last-seen, and alert state', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN, ROW_ALERTED], nextCursor: null }));
    await renderPage();

    expect(await screen.findByText('TypeError: boom')).toBeInTheDocument();
    expect(urlOf(0)).toMatch(/\/listSystemErrors$/);
    expect(screen.getByText('token missing')).toBeInTheDocument();
    expect(screen.getByText('client-error')).toBeInTheDocument();
    // "attempted" wording, not "alerted": alertedAt is stamped when a notify
    // attempt is CLAIMED, before the notifier runs, so it does not mean the
    // notification was actually delivered (Codex review finding).
    expect(screen.getByText('No alert attempted')).toBeInTheDocument();
    expect(screen.getByText('Alert attempted')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is unresolved and there is no further page', async () => {
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

  it('a long message is truncated behind a keyboard-accessible <details> expansion, collapsed by default', async () => {
    const longMessage = 'X'.repeat(200);
    fetch.mockResolvedValueOnce(
      okResponse({ rows: [{ ...ROW_OPEN, message: longMessage }], nextCursor: null }),
    );
    await renderPage();

    const summary = await screen.findByText(/show full message/i);
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    // <details>/<summary> is natively keyboard-focusable (Tab) and
    // Enter/Space-activatable with no bespoke ARIA wiring; collapsed by
    // default is what keeps the full 200-char message out of the way until
    // asked for.
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText(longMessage)).toBeInTheDocument();
  });
});

describe('manual refresh', () => {
  it('refetches the list on demand', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN], nextCursor: null }));
    await renderPage();
    await screen.findByText('TypeError: boom');

    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_ALERTED], nextCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(1)).toMatch(/\/listSystemErrors$/);
    expect(await screen.findByText('token missing')).toBeInTheDocument();
    expect(screen.queryByText('TypeError: boom')).toBeNull();
  });
});

describe('load more', () => {
  it('fetches the next page with the server cursor and appends it', async () => {
    const cursor = { createdAt: 1700000000000, id: 'e-open-1' };
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN], nextCursor: cursor }));
    await renderPage();
    await screen.findByText('TypeError: boom');
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();

    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_ALERTED], nextCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(1)).toMatch(/\/listSystemErrors$/);
    expect(bodyOf(1)).toEqual({ limit: 100, cursor });
    // Both pages' rows are visible, and the exhausted cursor removes the button.
    expect(await screen.findByText('token missing')).toBeInTheDocument();
    expect(screen.getByText('TypeError: boom')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

describe('resolving a row', () => {
  it('reloads from the server after a successful resolve, rather than only patching local state', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN], nextCursor: null }));
    await renderPage();
    await screen.findByText('TypeError: boom');

    fetch.mockResolvedValueOnce(okResponse({ id: 'e-open-1', resolved: true }));
    // The reload can surface a row that was past this page's limit — assert
    // the page renders the SERVER's post-resolve answer, not a client-side
    // guess (Codex review finding, P1).
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_ALERTED], nextCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(urlOf(1)).toMatch(/\/resolveSystemErrors$/);
    expect(bodyOf(1)).toEqual({ id: 'e-open-1', expectedLastSeenAt: ROW_OPEN.lastSeenAt });
    expect(urlOf(2)).toMatch(/\/listSystemErrors$/);

    await waitFor(() => expect(screen.queryByText('TypeError: boom')).toBeNull());
    expect(await screen.findByText('token missing')).toBeInTheDocument();
  });

  it('reloads to an empty state when the server confirms nothing unresolved remains', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN], nextCursor: null }));
    await renderPage();
    await screen.findByText('TypeError: boom');

    fetch.mockResolvedValueOnce(okResponse({ id: 'e-open-1', resolved: true }));
    fetch.mockResolvedValueOnce(okResponse({ rows: [], nextCursor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(await screen.findByText('No unresolved errors')).toBeInTheDocument();
  });

  it('reports a reopen race instead of pretending the resolve worked, and does not reload', async () => {
    fetch.mockResolvedValueOnce(okResponse({ rows: [ROW_OPEN], nextCursor: null }));
    await renderPage();
    await screen.findByText('TypeError: boom');

    fetch.mockResolvedValueOnce(okResponse({ id: 'e-open-1', resolved: false, reopened: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/recurred since the list loaded/i);
    // The row stays visible — it was NOT actually resolved.
    expect(screen.getByText('TypeError: boom')).toBeInTheDocument();
    // Not a "successful" resolve, so no reload — only the initial list call.
    expect(fetch).toHaveBeenCalledTimes(2);
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
