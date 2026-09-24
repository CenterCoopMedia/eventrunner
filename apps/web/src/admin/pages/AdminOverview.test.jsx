// The overview (issue #179): /admin opens here, and every figure on it is
// the number getEventStats answered, printed inside the sentence that says
// what it counts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { markTourDone } from '../tourState.js';

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
  funnel: [
    { id: 'accounts', count: 412 },
    { id: 'ticketed-or-approved', count: 280 },
    { id: 'approved', count: 250 },
  ],
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
  funnel: [
    { id: 'accounts', count: 0 },
    { id: 'ticketed-or-approved', count: 0 },
    { id: 'approved', count: 0 },
  ],
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

/** Push a config/event doc through the live listener, the way a save echoes back. */
async function pushEvent(data) {
  await waitFor(() => expect(configSubscriptions.has('event')).toBe(true));
  act(() => configSubscriptions.get('event')(data));
}

beforeEach(() => {
  // The editor tour (issue #198) opens on a first visit; this file tests
  // the page, so the account has already ended it.
  markTourDone('admin-1');
  configSubscriptions.clear();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
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

  // MILESTONES AND THE GOAL (issue #180): read from config/event, which the
  // event settings page saves and the live listener delivers here.
  describe('milestones', () => {
    it('lists a saved milestone with the days left, and the goal against the approved count', async () => {
      // Noon on Wednesday 14 October in the event's zone (America/New_York).
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-10-14T16:00:00Z'));
      fetch.mockResolvedValueOnce(okResponse(STATS));
      await renderAt('/admin/overview');
      await screen.findByRole('heading', { name: 'Event figures' });
      await pushEvent({
        milestones: [
          { label: 'Programme announced', date: '2026-10-26' },
          { label: 'Proposals close', date: '2026-10-11' },
          { label: 'Doors open', date: '2026-10-14' },
        ],
        registration: { goal: 500 },
      });

      const panel = (await screen.findByRole('heading', { name: 'Milestones' })).closest('section');
      const goal = within(panel).getByText(/toward the registration goal/);
      expect(goal.textContent).toBe('250 of 500 approved toward the registration goal.');
      const bar = within(panel).getByRole('progressbar');
      expect(bar.tagName).toBe('PROGRESS');
      expect(bar).toHaveAttribute('value', '250');
      expect(bar).toHaveAttribute('max', '500');
      expect(bar).toHaveAccessibleName('250 of 500 approved toward the registration goal.');
      expect(bar.className).toMatch(/accent-admin-action/);

      // Date order, each with its date in the data face and its distance in words.
      const items = within(panel).getAllByRole('listitem').map((li) => li.textContent);
      expect(items).toEqual([
        'Proposals close, Sunday, October 11, 3 days ago',
        'Doors open, Wednesday, October 14, Today',
        'Programme announced, Monday, October 26, In 12 days',
      ]);
      expect(within(panel).getByText('Monday, October 26').className).toMatch(/font-admin-data/);
    });

    it('renders nothing for an empty set and no goal', async () => {
      fetch.mockResolvedValueOnce(okResponse(STATS));
      await renderAt('/admin/overview');
      await screen.findByRole('heading', { name: 'Event figures' });

      await pushEvent({ milestones: [], registration: { goal: null } });
      expect(screen.queryByRole('heading', { name: 'Milestones' })).toBeNull();
      expect(screen.queryByRole('progressbar', { name: /registration goal/ })).toBeNull();
      expect(screen.queryByText(/registration goal/i)).toBeNull();

      // A goal alone is enough to draw the panel; clearing it removes it again.
      await pushEvent({ milestones: [], registration: { goal: 400 } });
      expect(await screen.findByRole('heading', { name: 'Milestones' })).toBeInTheDocument();
      await pushEvent({ milestones: null, registration: {} });
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Milestones' })).toBeNull());
    });

    it('states the goal on its own until the approved count arrives', async () => {
      const held = heldResponse();
      fetch.mockReturnValueOnce(held.promise);
      await renderAt('/admin/overview');
      await pushEvent({ registration: { goal: 500 } });

      const panel = (await screen.findByRole('heading', { name: 'Milestones' })).closest('section');
      expect(panel.textContent).toContain('Registration goal: 500 approved.');
      expect(within(panel).queryByRole('progressbar')).toBeNull();

      await act(async () => {
        held.release(okResponse(STATS));
      });
      expect(await within(panel).findByRole('progressbar')).toBeInTheDocument();
    });
  });

  // THE FUNNEL AND READINESS PANELS (issue #181), read from the same answer.
  describe('the funnel and content readiness', () => {
    it('states each funnel stage as a fraction of all accounts beside a bar it labels', async () => {
      fetch.mockResolvedValueOnce(okResponse(STATS));
      await renderAt('/admin/overview');
      const panel = (await screen.findByRole('heading', { name: 'Registration funnel' })).closest('section');

      const stages = within(panel).getAllByRole('listitem');
      expect(stages.map((li) => li.querySelector('p').textContent.replace(/\s+/g, ' ').trim())).toEqual([
        'Accounts: 412 of 412',
        'Ticketed or approved: 280 of 412',
        'Approved: 250 of 412',
      ]);
      const bars = within(panel).getAllByRole('progressbar');
      expect(bars.map((bar) => bar.tagName)).toEqual(['PROGRESS', 'PROGRESS', 'PROGRESS']);
      expect(bars.map((bar) => [bar.getAttribute('value'), bar.getAttribute('max')])).toEqual([
        ['412', '412'], ['280', '412'], ['250', '412'],
      ]);
      expect(bars[1]).toHaveAccessibleName('Ticketed or approved: 280 of 412');
      expect(panel.textContent).toContain('12 revoked. They count as accounts but not in the later stages.');
    });

    it('lists what is on the site and what has unpublished changes, per collection', async () => {
      fetch.mockResolvedValueOnce(okResponse(STATS));
      await renderAt('/admin/overview');
      await screen.findByRole('heading', { name: 'Content readiness' });

      const table = screen.getByRole('table', { name: 'Records on the site and records with unpublished changes, by collection.' });
      expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
        'Collection', 'On the site', 'Unpublished changes',
      ]);
      const rows = within(table).getAllByRole('row').slice(1)
        .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
      expect(rows).toEqual([
        ['Pages', '15', '16'],
        ['Content blocks', '90', '8'],
        ['Sessions', '48', '9'],
        ['Organizations', '11', '0'],
        ['Timeline', '0', '0'],
        ['Updates', '17', '14'],
      ]);
      // Figures end-aligned in the data face.
      const cell = within(table).getAllByRole('cell')[1];
      expect(cell.className).toMatch(/text-end/);
      expect(cell.className).toMatch(/tabular-nums/);
      expect(screen.queryByText('Nothing is on the site yet.')).toBeNull();
      // "saved" is the attendee's word for a bookmark; it never labels a draft.
      expect(table.textContent).not.toMatch(/saved/i);
    });

    it('states zero clearly in both panels for an empty deployment', async () => {
      fetch.mockResolvedValueOnce(okResponse(ZERO));
      await renderAt('/admin/overview');

      const funnel = (await screen.findByRole('heading', { name: 'Registration funnel' })).closest('section');
      expect(funnel.textContent).toContain('No one has signed up yet.');
      expect(within(funnel).queryByRole('progressbar')).toBeNull();
      expect(funnel.textContent).not.toContain('revoked');

      const readiness = screen.getByRole('heading', { name: 'Content readiness' }).closest('section');
      expect(readiness.textContent).toContain('Nothing is on the site yet.');
      const cells = within(readiness).getAllByRole('cell').map((cell) => cell.textContent);
      expect(cells.filter((text) => /^\d+$/.test(text))).toEqual(Array(12).fill('0'));
    });

    it('keeps the keyboard path short: Refresh figures, then the readiness table', async () => {
      fetch.mockResolvedValueOnce(okResponse({
        ...STATS,
        registrations: { ...STATS.registrations, byStatus: { ...STATS.registrations.byStatus, revoked: 1 } },
      }));
      await renderAt('/admin/overview');
      await screen.findByRole('heading', { name: 'Content readiness' });

      const main = document.getElementById('admin-content');
      const stops = [...main.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
        .filter((el) => el.getAttribute('tabindex') !== '-1');
      expect(stops.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual([
        'Refresh figures',
        'Records on the site and records with unpublished changes, by collection.',
      ]);
      const region = screen.getByRole('region', { name: 'Records on the site and records with unpublished changes, by collection.' });
      expect(region).toHaveAttribute('tabindex', '0');
      const funnel = screen.getByRole('heading', { name: 'Registration funnel' }).closest('section');
      expect(funnel.textContent).toContain('1 revoked. It counts as an account but not in the later stages.');
    });
  });
});
