// The overview (issue #179): /admin opens here, and every figure on it is
// the number getEventStats answered, printed inside the sentence that says
// what it counts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const configSubscriptions = new Map();
vi.mock('../../lib/configSource.js', () => ({
  subscribeConfigDoc: (docId, onNext) => {
    configSubscriptions.set(docId, onNext);
    return () => configSubscriptions.delete(docId);
  },
}));
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
  collection: vi.fn((_db, name) => ({ name })),
  query: vi.fn((ref) => ref),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../../App.jsx';

// A distinct value for every figure, so a swapped mapping cannot pass.
const STATS = {
  readAt: '2026-10-14T13:14:00.000Z',
  registrations: {
    total: 412,
    byStatus: { pending: 120, ticketed: 30, approved: 250, revoked: 12 },
    profileComplete: 300,
  },
  tickets: { total: 280, byStatus: { valid: 260, refunded: 13, cancelled: 5, pending_info: 2 } },
  speakers: { total: 24, byStatus: { draft: 6, invited: 7, accepted: 3, approved: 4, removed: 1 } },
  content: {
    cmsContent: { published: 90, drafts: 8 },
    cmsSchedule: { published: 48, drafts: 9 },
    cmsOrganizations: { published: 11, drafts: 0 },
    cmsTimeline: { published: 0, drafts: 0 },
    cmsUpdates: { published: 17, drafts: 14 },
    cmsPages: { published: 15, drafts: 16 },
  },
  errors: { unresolved: 21 },
};

/** Every figure at zero: the endpoint's answer for an empty deployment. */
const ZERO = {
  readAt: '2026-10-14T13:14:00.000Z',
  registrations: { total: 0, byStatus: { pending: 0, ticketed: 0, approved: 0, revoked: 0 }, profileComplete: 0 },
  tickets: { total: 0, byStatus: { valid: 0, refunded: 0, cancelled: 0, pending_info: 0 } },
  speakers: { total: 0, byStatus: { draft: 0, invited: 0, accepted: 0, approved: 0, removed: 0 } },
  content: Object.fromEntries(
    ['cmsContent', 'cmsSchedule', 'cmsOrganizations', 'cmsTimeline', 'cmsUpdates', 'cmsPages']
      .map((name) => [name, { published: 0, drafts: 0 }]),
  ),
  errors: { unresolved: 0 },
};

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}

/** A fetch that answers only when the test says so. */
function heldResponse() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function renderAt(path) {
  const result = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>,
  );
  await waitFor(
    () => {
      expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Loading overview…')).not.toBeInTheDocument();
    },
    { timeout: 10_000 },
  );
  return result;
}

/** The sentence (list item) that holds `text`, as its whole text. */
function sentence(panelTitle, text) {
  const panel = screen.getByRole('heading', { name: panelTitle }).closest('section');
  const item = within(panel).getAllByRole('listitem').find((li) => li.textContent.includes(text));
  return item?.textContent.replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  configSubscriptions.clear();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the admin overview', () => {
  it('opens at /admin and prints every figure the endpoint answered, each in its own sentence', async () => {
    fetch.mockResolvedValueOnce(okResponse(STATS));
    await renderAt('/admin');

    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Event figures' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/getEventStats$/);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');

    expect(sentence('Event figures', 'accounts:')).toBe(
      '412 accounts: 120 pending, 30 ticketed, 250 approved, 12 revoked.',
    );
    expect(sentence('Event figures', 'profiles complete')).toBe('300 of 412 profiles complete.');
    expect(sentence('Event figures', 'tickets:')).toBe(
      '280 tickets: 260 valid, 13 refunded, 5 cancelled, 2 waiting for details.',
    );
    expect(sentence('Event figures', 'speakers:')).toBe(
      '24 speakers: 6 draft, 7 invited, 3 accepted, 4 approved, 1 removed.',
    );
    expect(sentence('Event figures', 'on the site')).toBe('48 sessions on the site. 9 with unpublished changes.');
    expect(sentence('Event figures', 'unresolved')).toBe('21 unresolved errors.');

    // The number is in the data face, bold and tabular, beside its words.
    const [figure] = screen.getAllByText('412', { selector: 'span' });
    expect(figure.className).toMatch(/font-admin-data/);
    expect(figure.className).toMatch(/tabular-nums/);
    expect(figure.className).toMatch(/font-bold/);

    // When the figures were read, on the event's clock.
    expect(screen.getByText('Read at 9:14 AM EDT')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Figures read at 9:14 AM EDT.');
    // No tiles, no rings: the figures are a list of sentences.
    expect(document.querySelector('svg circle')).toBeNull();
  });

  it('takes the singular at one and prints zero as 0', async () => {
    fetch.mockResolvedValueOnce(okResponse({
      ...ZERO,
      registrations: { total: 1, byStatus: { pending: 1, ticketed: 0, approved: 0, revoked: 0 }, profileComplete: 0 },
      tickets: { total: 1, byStatus: { valid: 1, refunded: 0, cancelled: 0, pending_info: 0 } },
      speakers: { total: 1, byStatus: { draft: 1, invited: 0, accepted: 0, approved: 0, removed: 0 } },
      content: { ...ZERO.content, cmsSchedule: { published: 1, drafts: 1 } },
      errors: { unresolved: 1 },
    }));
    await renderAt('/admin/overview');
    await screen.findByRole('heading', { name: 'Event figures' });

    expect(sentence('Event figures', 'account:')).toBe('1 account: 1 pending, 0 ticketed, 0 approved, 0 revoked.');
    expect(sentence('Event figures', 'complete')).toBe('0 of 1 profile complete.');
    expect(sentence('Event figures', 'ticket:')).toBe('1 ticket: 1 valid, 0 refunded, 0 cancelled, 0 waiting for details.');
    expect(sentence('Event figures', 'speaker:')).toBe('1 speaker: 1 draft, 0 invited, 0 accepted, 0 approved, 0 removed.');
    expect(sentence('Event figures', 'on the site')).toBe('1 session on the site. 1 with unpublished changes.');
    expect(sentence('Event figures', 'unresolved')).toBe('1 unresolved error.');
  });

  it('states zero for every figure of an empty deployment', async () => {
    fetch.mockResolvedValueOnce(okResponse(ZERO));
    await renderAt('/admin/overview');
    await screen.findByRole('heading', { name: 'Event figures' });

    expect(sentence('Event figures', 'accounts:')).toBe('0 accounts: 0 pending, 0 ticketed, 0 approved, 0 revoked.');
    expect(sentence('Event figures', 'complete')).toBe('0 of 0 profiles complete.');
    expect(sentence('Event figures', 'unresolved')).toBe('0 unresolved errors.');
  });

  it('says what is loading until the first answer arrives', async () => {
    const held = heldResponse();
    fetch.mockReturnValueOnce(held.promise);
    await renderAt('/admin/overview');

    expect(await screen.findByRole('status', { name: 'Loading the event figures…' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Event figures' })).toBeNull();

    await act(async () => {
      held.release(okResponse(STATS));
    });
    expect(await screen.findByRole('heading', { name: 'Event figures' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading the event figures…' })).toBeNull();
  });

  it('shows the server’s words and no figures when the first read fails', async () => {
    fetch.mockResolvedValueOnce(
      errorResponse(500, 'internal', 'The event figures are not available right now. Try again.'),
    );
    await renderAt('/admin/overview');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The event figures are not available right now. Try again.');
    expect(screen.queryByRole('heading', { name: 'Event figures' })).toBeNull();
    expect(screen.queryByText(/Read at/)).toBeNull();
  });

  it('refuses a non-admin answer the same way, with the server’s words', async () => {
    fetch.mockResolvedValueOnce(errorResponse(403, 'forbidden', 'Admin access required.'));
    await renderAt('/admin/overview');
    expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required.');
    expect(screen.queryByRole('heading', { name: 'Event figures' })).toBeNull();
  });

  it('refreshes on request, states the new time, and ignores a second press while busy', async () => {
    fetch.mockResolvedValueOnce(okResponse(STATS));
    await renderAt('/admin/overview');
    await screen.findByText('Read at 9:14 AM EDT');

    const refresh = screen.getByRole('button', { name: 'Refresh figures' });
    const held = heldResponse();
    fetch.mockReturnValueOnce(held.promise);
    refresh.focus();
    fireEvent.click(refresh);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(refresh).toHaveTextContent('Refreshing…');
    expect(refresh).toHaveAttribute('aria-busy', 'true');
    expect(refresh).toHaveAttribute('aria-disabled', 'true');
    // Never disabled, so the focus stays on it.
    expect(refresh).not.toBeDisabled();
    expect(document.activeElement).toBe(refresh);

    // A second press while the first request runs sends nothing.
    fireEvent.click(refresh);
    fireEvent.keyDown(refresh, { key: 'Enter' });
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      held.release(okResponse({
        ...STATS,
        readAt: '2026-10-14T13:20:00.000Z',
        registrations: { ...STATS.registrations, total: 413 },
      }));
    });
    expect(await screen.findByText('Read at 9:20 AM EDT')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Figures read at 9:20 AM EDT.');
    expect(sentence('Event figures', 'accounts:')).toMatch(/^413 accounts:/);
    expect(refresh).toHaveTextContent('Refresh figures');
    expect(refresh).not.toHaveAttribute('aria-busy');
    expect(document.activeElement).toBe(refresh);
  });

  it('keeps the figures it has when a refresh fails, and says when they were read', async () => {
    fetch.mockResolvedValueOnce(okResponse(STATS));
    await renderAt('/admin/overview');
    await screen.findByText('Read at 9:14 AM EDT');

    fetch.mockResolvedValueOnce(errorResponse(500, 'internal', 'The event figures are not available right now. Try again.'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh figures' }));

    expect(
      await screen.findByText('We could not refresh the figures. These are the figures read at 9:14 AM EDT.'),
    ).toBeInTheDocument();
    expect(sentence('Event figures', 'accounts:')).toMatch(/^412 accounts:/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
