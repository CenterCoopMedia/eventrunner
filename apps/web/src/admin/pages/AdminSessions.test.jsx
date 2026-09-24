import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const adminSubscriptions = new Map();
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => {
    adminSubscriptions.set(name, onNext);
    onNext([]);
    return () => adminSubscriptions.delete(name);
  },
}));
const configSubscriptions = new Map();
vi.mock('../../lib/configSource.js', () => ({
  subscribeConfigDoc: (docId, onNext) => {
    configSubscriptions.set(docId, onNext);
    return () => configSubscriptions.delete(docId);
  },
}));
// The public bookmark counts (issue #182). Mocked for every test: the
// firebase/firestore mock below has no onSnapshot, and the Sessions list
// mounts the Most saved panel whenever it has sessions.
const bookmarkCounts = { onNext: null, onError: null };
vi.mock('../../lib/bookmarkCountsSource.js', () => ({
  subscribeBookmarkCounts: (onNext, onError) => {
    bookmarkCounts.onNext = onNext;
    bookmarkCounts.onError = onError;
    return () => {};
  },
}));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));
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
import { NEW_TAB_NOTE } from '../../components/ExternalLink.jsx';

function response(body) {
  return { ok: true, status: 200, json: async () => body };
}

async function renderAt(path) {
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
  }, { timeout: 10_000 });
}

function pushSessions(live, drafts) {
  act(() => {
    adminSubscriptions.get('cmsSchedule')(live);
    adminSubscriptions.get('cmsSchedule_drafts')(drafts);
  });
}

function bodyOf(index) {
  return JSON.parse(fetch.mock.calls[index][1].body);
}

beforeEach(() => {
  adminSubscriptions.clear();
  configSubscriptions.clear();
  bookmarkCounts.onNext = null;
  bookmarkCounts.onError = null;
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('admin Sessions workspace', () => {
  it('groups by day and keeps a child directly below its parent', async () => {
    await renderAt('/admin/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });
    pushSessions(
      [{ id: 'later', dayId: 'day-1', startTime: '10:00', title: 'Later', visible: true }],
      [
        { id: 'parent', dayId: 'day-1', startTime: '09:00', title: 'Parent', status: 'dirty' },
        { id: 'child', dayId: 'day-1', startTime: '11:00', title: 'Child', parentId: 'parent', status: 'dirty' },
      ],
    );
    const links = screen.getAllByRole('link').filter((link) =>
      ['Parent', 'Child', 'Later'].includes(link.textContent),
    );
    expect(links.map((link) => link.textContent)).toEqual(['Parent', 'Child', 'Later']);
    expect(screen.getByRole('link', { name: 'Create a session' })).toBeInTheDocument();
  });

  it('creates a draft through the generic schedule endpoint', async () => {
    await renderAt('/admin/sessions/new/session');
    await screen.findByRole('heading', { name: 'New session' });
    fetch.mockResolvedValueOnce(response({ docId: 'opening-session', status: 'dirty' }));
    fireEvent.change(screen.getByLabelText('Public title'), { target: { value: 'Opening session' } });
    expect(screen.getByLabelText('Session id')).toHaveValue('opening-session');
    fireEvent.change(screen.getByLabelText('Public description'), { target: { value: 'Welcome everyone.' } });
    fireEvent.change(screen.getByLabelText('Event day'), { target: { value: 'day-1' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/cmsCreateContent$/);
    expect(bodyOf(0)).toMatchObject({
      collection: 'cmsSchedule',
      docId: 'opening-session',
      fields: { title: 'Opening session', dayId: 'day-1', startTime: '09:00', endTime: '10:00' },
    });
  });

  it('sends the recording link, and refuses an unsafe one before it reaches the server', async () => {
    await renderAt('/admin/sessions/new/session');
    await screen.findByRole('heading', { name: 'New session' });
    fireEvent.change(screen.getByLabelText('Public title'), { target: { value: 'Opening session' } });
    fireEvent.change(screen.getByLabelText('Public description'), { target: { value: 'Welcome everyone.' } });
    fireEvent.change(screen.getByLabelText('Event day'), { target: { value: 'day-1' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '10:00' } });

    const field = screen.getByLabelText('Recording link');
    // A scheme with no slashes is the typo an operator cannot see, and it
    // is the one the old protocol-only check let through: stored, it
    // resolves as a path on the event's own site rather than reaching the
    // video host at all. The editor refuses it for the same reason the
    // server does, and with the same wording.
    for (const bad of ['javascript:alert(1)', 'https:video.example.org/watch', '//video.example.org/x']) {
      fireEvent.change(field, { target: { value: bad } });
      expect(
        await screen.findByText('Enter a link that starts with http:// or https://.'),
        `accepted ${bad}`,
      ).toBeInTheDocument();
      expect(field).toHaveAttribute('aria-invalid', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
      expect(fetch).not.toHaveBeenCalled();
    }

    fetch.mockResolvedValueOnce(response({ docId: 'opening-session', status: 'dirty' }));
    fireEvent.change(field, { target: { value: 'https://video.example.org/watch?v=abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).fields.recordingUrl).toBe('https://video.example.org/watch?v=abc');
  });

  it('answers an invalid save instead of going quiet', async () => {
    // A disabled control announces nothing. An operator who presses Save
    // with a bad field used to get silence; the control now stays enabled,
    // sends nothing, and puts the operator on the field that stopped it.
    await renderAt('/admin/sessions/new/session');
    await screen.findByRole('heading', { name: 'New session' });

    for (const name of ['Save draft', 'Save and publish']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(fetch).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute('aria-invalid', 'true');
    });
    // The field that has focus is the first invalid one in the form.
    const marked = document.querySelectorAll('[aria-invalid="true"]');
    expect(marked[0]).toBe(document.activeElement);
  });

  it('keeps creation separate from a session named new and encodes edit links', async () => {
    await renderAt('/admin/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });
    pushSessions([], [
      { id: 'new', dayId: 'day-1', title: 'Named new', status: 'dirty' },
      { id: 'panel?day2#room', dayId: 'day-1', title: 'Panel', status: 'dirty' },
    ]);

    expect(screen.getByRole('link', { name: 'Create a session' }))
      .toHaveAttribute('href', '/admin/sessions/new/session');
    expect(screen.getByRole('link', { name: 'Named new' }))
      .toHaveAttribute('href', '/admin/sessions/new');
    expect(screen.getByRole('link', { name: 'Panel' }))
      .toHaveAttribute('href', '/admin/sessions/panel%3Fday2%23room');
  });

  it('resumes a part-way bulk publish with the queue id', async () => {
    await renderAt('/admin/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });
    pushSessions([], [
      { id: 'opening', dayId: 'day-1', title: 'Opening', status: 'dirty' },
    ]);
    fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { code: 'publish-failed', message: 'Publish failed part-way.' },
          queueId: 'queue-42',
        }),
      })
      .mockResolvedValueOnce(response({
        results: { cmsSchedule: { published: ['opening'], skipped: [] } },
      }));

    fireEvent.click(screen.getByRole('button', { name: 'Publish all (1)' }));
    const resume = await screen.findByRole('button', { name: 'Resume publish' });
    fireEvent.click(resume);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1)).toEqual({ queueId: 'queue-42' });
  });

  // The editor's route is a sibling of the list under the admin layout, so
  // a plain navigate('..') went to the admin index. Cancel names the list.
  it('returns to the sessions list on Cancel', async () => {
    await renderAt('/admin/sessions/child');
    await waitFor(() => expect(adminSubscriptions.has('cmsSchedule_drafts')).toBe(true));
    pushSessions([], [
      {
        id: 'child', dayId: 'day-1', startTime: '09:30', endTime: '10:00',
        title: 'Child', description: 'Child session.', status: 'dirty',
      },
    ]);
    expect(await screen.findByDisplayValue('Child')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sessions' })).toBeInTheDocument();
  });

  it('publishes a draft-only parent with its child', async () => {
    await renderAt('/admin/sessions/child');
    await waitFor(() => expect(adminSubscriptions.has('cmsSchedule_drafts')).toBe(true));
    pushSessions([], [
      {
        id: 'parent', dayId: 'day-1', startTime: '09:00', endTime: '11:00',
        title: 'Parent', description: 'Parent session.', status: 'dirty',
      },
      {
        id: 'child', dayId: 'day-1', startTime: '09:30', endTime: '10:00',
        title: 'Child', description: 'Child session.', parentId: 'parent', status: 'dirty',
      },
    ]);
    expect(await screen.findByDisplayValue('Child')).toBeInTheDocument();
    fetch
      .mockResolvedValueOnce(response({ docId: 'child', status: 'dirty' }))
      .mockResolvedValueOnce(response({
        results: { cmsSchedule: { published: ['parent', 'child'], skipped: [] } },
      }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(String(fetch.mock.calls[1][0])).toMatch(/\/cmsPublish$/);
    expect(bodyOf(1).docIds).toEqual(['parent', 'child']);
  });

  it('names a saved day that no longer exists, rather than showing "no day chosen" (issue 248)', async () => {
    // A <select> whose value matches none of its <option>s falls back to
    // showing the first option — "Select a day" — even though the stored
    // value is still 'day-9'. That reads as an empty field to an operator
    // who never touched it, so the actual stored value needs its own
    // option, named plainly, never the bare id standing in as if it were a
    // real day's name.
    await renderAt('/admin/sessions/orphan');
    await waitFor(() => expect(adminSubscriptions.has('cmsSchedule_drafts')).toBe(true));
    pushSessions([], [
      { id: 'orphan', dayId: 'day-9', title: 'Orphan', description: 'On a removed day.', status: 'dirty' },
    ]);
    const select = await screen.findByLabelText('Event day');
    expect(select).toHaveValue('day-9');
    expect(screen.getByRole('option', { name: 'day-9 (not on a configured day)' })).toBeInTheDocument();
  });

  it('says that the preview opens a new tab, inside the link name (issue 236)', async () => {
    // A new tab is a change of context. A reader who can see the page reads
    // it off the tab strip; a reader using a screen reader gets no signal
    // at all unless the sentence is part of the link's own name.
    await renderAt('/admin/sessions/child');
    await waitFor(() => expect(adminSubscriptions.has('cmsSchedule_drafts')).toBe(true));
    pushSessions([], [
      {
        id: 'child', dayId: 'day-1', startTime: '09:30', endTime: '10:00',
        title: 'Child', description: 'Child session.', status: 'dirty',
      },
    ]);
    expect(await screen.findByDisplayValue('Child')).toBeInTheDocument();
    const preview = screen.getByRole('link', { name: /Preview draft/ });
    expect(preview).toHaveAttribute('target', '_blank');
    expect(preview).toHaveAccessibleName(`Preview draft (${NEW_TAB_NOTE})`);
  });

  // SESSION POPULARITY (issue #182): the Most saved panel above the day
  // groups, from the public sessionBookmarks counts.
  describe('the Most saved panel', () => {
    const LIVE = [
      { id: 'keynote', dayId: 'day-1', startTime: '09:00', title: 'Keynote', visible: true },
      { id: 'audience', dayId: 'day-1', startTime: '10:00', title: 'Audience research', visible: true },
      { id: 'lunch', dayId: 'day-1', startTime: '12:00', title: 'Lunch', visible: true },
      { id: 'data', dayId: 'day-2', startTime: '09:00', title: 'Data desk', visible: true },
      { id: 'lost', dayId: 'day-9', startTime: '09:00', title: 'Lost day', visible: true },
    ];
    const DRAFTS = [
      { id: 'fresh', dayId: 'day-1', startTime: '15:00', title: 'Fresh draft', status: 'dirty' },
    ];

    async function openSessions(features = { sessionBookmarks: true }) {
      await renderAt('/admin/sessions');
      await screen.findByRole('heading', { name: 'Sessions' });
      if (features) {
        await waitFor(() => expect(configSubscriptions.has('features')).toBe(true));
        act(() => configSubscriptions.get('features')(features));
      }
      pushSessions(LIVE, DRAFTS);
      return (await screen.findByRole('heading', { name: 'Most saved' })).closest('section');
    }

    it('orders the sessions by saves, most first, with the day each is on', async () => {
      const panel = await openSessions();
      act(() => bookmarkCounts.onNext(new Map([['keynote', 3], ['data', 12], ['lost', 7], ['gone', 40]])));

      const table = within(panel).getByRole('table', { name: 'Sessions by saves, most first.' });
      const rows = within(table).getAllByRole('row').slice(1)
        .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
      // Neither title order nor schedule order: count order. A count for a
      // session that no longer exists is left out.
      expect(rows).toEqual([
        ['Data desk', 'Day two', '12'],
        ['Lost day', 'Not on a configured day', '7'],
        ['Keynote', 'Day one', '3'],
      ]);
      expect(within(table).getByRole('columnheader', { name: 'Saved' })).toHaveAttribute('aria-sort', 'descending');
      expect(within(table).getByRole('link', { name: 'Data desk' })).toHaveAttribute('href', '/admin/sessions/data');
      // The region scrolls on its own, and a keyboard can reach it.
      const region = within(panel).getByRole('region', { name: 'Sessions by saves, most first.' });
      expect(region).toHaveAttribute('tabindex', '0');
      expect(region.className).toMatch(/max-h-\[20rem\]/);
      // Audience research and Lunch are on the site with no saves; the draft
      // cannot have been saved, so it is not counted.
      expect(panel.textContent).toContain('2 sessions on the site have no saves yet.');
      expect(panel.textContent).not.toContain('Saving sessions is off');
    });

    it('states when no session has been saved', async () => {
      const panel = await openSessions();
      act(() => bookmarkCounts.onNext(new Map()));
      expect(within(panel).getByText('No session has been saved yet.')).toBeInTheDocument();
      expect(within(panel).queryByRole('table')).toBeNull();
      expect(panel.textContent).toContain('5 sessions on the site have no saves yet.');
    });

    it('says the counts cannot change while saving sessions is off', async () => {
      const panel = await openSessions({ sessionBookmarks: false });
      act(() => bookmarkCounts.onNext(new Map([['keynote', 1]])));
      expect(panel.textContent).toContain('Saving sessions is off for this event, so these counts do not change.');
      expect(within(panel).getByRole('table')).toBeInTheDocument();
    });

    it('says it is loading until the first counts arrive, and keeps the last counts when the listener fails', async () => {
      const panel = await openSessions();
      expect(within(panel).getByRole('status', { name: 'Loading saves…' })).toBeInTheDocument();

      act(() => bookmarkCounts.onNext(new Map([['audience', 2]])));
      expect(within(panel).queryByRole('status', { name: 'Loading saves…' })).toBeNull();
      act(() => bookmarkCounts.onError(new Error('unavailable')));
      expect(within(panel).getByText(/We lost the connection to the saves/)).toBeInTheDocument();
      expect(within(panel).getByRole('link', { name: 'Audience research' })).toBeInTheDocument();

      act(() => bookmarkCounts.onNext(new Map([['audience', 3]])));
      expect(within(panel).queryByText(/We lost the connection to the saves/)).toBeNull();
      expect(within(panel).getAllByRole('cell').map((cell) => cell.textContent)).toContain('3');
    });

    it('says so when the counts fail before any arrive', async () => {
      const panel = await openSessions();
      act(() => bookmarkCounts.onError(new Error('unavailable')));
      expect(within(panel).getByText('We could not load the saves. We keep trying.')).toBeInTheDocument();
      expect(within(panel).queryByRole('status', { name: 'Loading saves…' })).toBeNull();
    });

    it('puts the panel between the title band and the day groups in the keyboard path', async () => {
      const panel = await openSessions();
      act(() => bookmarkCounts.onNext(new Map([['keynote', 3]])));
      const main = document.getElementById('admin-content');
      const stops = [...main.querySelectorAll('a[href], button, [tabindex="0"]')];
      const names = stops.map((el) => el.getAttribute('aria-label') ?? el.textContent);
      const create = names.indexOf('Create a session');
      const region = names.indexOf('Sessions by saves, most first.');
      expect(create).toBeGreaterThanOrEqual(0);
      expect(region).toBe(create + 1);
      expect(names[region + 1]).toBe('Keynote');
      // Then the day groups, whose first row link is Keynote again.
      expect(names.slice(region + 2)).toContain('Keynote');
      expect(panel.compareDocumentPosition(screen.getByRole('heading', { name: 'Day one' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('draws no panel while there are no sessions', async () => {
      await renderAt('/admin/sessions');
      await screen.findByRole('heading', { name: 'Sessions' });
      pushSessions([], []);
      expect(await screen.findByRole('heading', { name: 'No sessions yet' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Most saved' })).toBeNull();
    });
  });
});
