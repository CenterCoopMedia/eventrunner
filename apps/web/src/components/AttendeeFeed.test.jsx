// The attendee feed at its boundaries (issue #788). The real
// EventConfigProvider, AuthProvider and ProfileProvider run; only the
// Firebase SDK calls and `fetch` are fakes. Expected values come from the
// #788 contract: no request until the live features document turns both
// flags on for a reader with a current grant; every account transition
// hides the previous reader's feed; active roots only; a safe author
// fallback; a report that sends only the post id, once per click.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { onAuthStateChanged } from 'firebase/auth';
import { getDoc, getDocs, getDocsFromServer, onSnapshot } from 'firebase/firestore';
import { auth } from '../firebase.js';

// The build snapshot turns the feed ON, so every "no request" case below
// also proves that a generated snapshot cannot open an unresolved feed.
vi.mock('@generated/eventConfig.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, features: { ...original.features, attendeeDirectory: true, socialFeed: true } };
});

const { EventConfigProvider } = await import('../contexts/EventConfigContext.jsx');
const { AuthProvider, useAuth } = await import('../contexts/AuthContext.jsx');
const { ProfileProvider, useProfile } = await import('../contexts/ProfileContext.jsx');
const { default: AttendeeFeed } = await import('./AttendeeFeed.jsx');

const FEED_ON = { attendeeDirectory: true, socialFeed: true };
const APPROVED = { registrationStatus: 'approved', speakerId: null };
const PENDING = { registrationStatus: 'pending', speakerId: null };

function makeUser(uid) {
  return { uid, email: `${uid}@example.test`, emailVerified: true, getIdToken: vi.fn(async () => `token-${uid}`) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// --- Firestore fakes, routed by path ------------------------------------

/** Every onSnapshot registration, in order. */
let listeners;
/** UIDs whose admin probes succeed (current bootstrap grant). */
let admins;
/** A per-uid gate that holds that user's admin probes open. */
let probeGates;
/** users_public projections by uid; a missing uid is unreadable. */
let projections;
/** Pages the older-posts fetch returns, in order. */
let olderPages;

function pathOf(target) {
  if (Array.isArray(target?.path)) return target.path.join('/');
  if (typeof target?.ref?.path === 'string') return target.ref.path;
  return String(target?.path);
}

function docSnap(id, data) {
  return { id, exists: () => data != null, data: () => data };
}

function listenersFor(path) {
  return listeners.filter((entry) => entry.path === path);
}

function activeFeedListeners() {
  return listenersFor('social_posts').filter((entry) => entry.active);
}

function pushDoc(path, data) {
  const entry = listenersFor(path).filter((item) => item.active).at(-1);
  if (!entry) throw new Error(`no live listener for ${path}`);
  act(() => entry.next(docSnap(path.split('/').at(-1), data)));
}

function pushPosts(entry, posts, { fromCache = false } = {}) {
  const docs = posts.map((item) => ({ id: item.id, data: () => item }));
  if (!fromCache) entry.lastDocs = docs;
  act(() => entry.next({ docs, metadata: { fromCache } }));
}

function post(id, authorUid, text, extra = {}) {
  return { id, state: 'active', authorUid, text, createdAt: new Date('2026-11-01T12:00:00Z'), parentPostId: null, ...extra };
}

// --- Auth fake --------------------------------------------------------------

let authListener;

function publishAuth(nextUser) {
  auth.currentUser = nextUser;
  act(() => authListener(nextUser));
}

// --- Render -----------------------------------------------------------------

/** Every render's verdicts, to prove no render pairs a uid with another account's verdict. */
let renders;

function Recorder() {
  const { user, adminStatus } = useAuth();
  const { uid, profile, status } = useProfile();
  renders.push({ authUid: user?.uid ?? null, uid, profileUid: profile?.id ?? null, status, adminStatus });
  return null;
}

function renderFeed() {
  return render(
    <EventConfigProvider>
      <AuthProvider>
        <ProfileProvider>
          <MemoryRouter>
            <Recorder />
            <AttendeeFeed />
          </MemoryRouter>
        </ProfileProvider>
      </AuthProvider>
    </EventConfigProvider>,
  );
}

/** Sign `user` in, seed their account document, and turn the feed on. */
async function openFeedAs(user, account = APPROVED, features = FEED_ON) {
  publishAuth(user);
  pushDoc(`users/${user.uid}`, { uid: user.uid, ...account });
  pushDoc('config/features', features);
  await act(async () => {});
}

beforeEach(() => {
  vi.stubEnv('VITE_FUNCTIONS_ORIGIN', 'https://functions.example.test');
  vi.stubGlobal('fetch', vi.fn());
  listeners = [];
  admins = new Set();
  probeGates = new Map();
  projections = new Map();
  olderPages = [];
  renders = [];
  auth.currentUser = null;
  vi.mocked(onAuthStateChanged).mockImplementation((_auth, listener) => {
    authListener = listener;
    listener(auth.currentUser);
    return () => {};
  });
  vi.mocked(onSnapshot).mockImplementation((target, ...rest) => {
    const options = typeof rest[0] === 'function' ? {} : rest.shift();
    const [next, error] = rest;
    const entry = { path: pathOf(target), target, options, next, error, active: true };
    listeners.push(entry);
    return () => { entry.active = false; };
  });
  vi.mocked(getDocsFromServer).mockReset().mockImplementation(async () => {
    const page = olderPages.shift();
    if (page instanceof Error) throw page;
    return { docs: (page ?? []).map((item) => ({ id: item.id, data: () => item })) };
  });
  vi.mocked(getDocs).mockImplementation(async (target) => {
    const uid = auth.currentUser?.uid;
    if (probeGates.has(uid)) await probeGates.get(uid).promise;
    if (admins.has(uid)) return { docs: [] };
    throw Object.assign(new Error(`denied ${pathOf(target)}`), { code: 'permission-denied' });
  });
  vi.mocked(getDoc).mockImplementation(async (target) => {
    const path = pathOf(target);
    const [collectionName, id] = path.split('/');
    if (collectionName === 'users_public' && projections.has(id)) return docSnap(id, projections.get(id));
    throw Object.assign(new Error(`denied ${path}`), { code: 'permission-denied' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete auth.currentUser;
});

describe('when the feed asks for posts', () => {
  it('asks nothing while config/features is unresolved, even with the snapshot on and another config document live', async () => {
    renderFeed();
    publishAuth(makeUser('ada'));
    pushDoc('users/ada', { uid: 'ada', ...APPROVED });
    pushDoc('config/event', { name: 'Example event' });
    await act(async () => {});
    expect(listenersFor('social_posts')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Attendee feed' })).not.toBeInTheDocument();
  });

  it.each([
    ['the feed flag missing', { attendeeDirectory: true }],
    ['the directory flag missing', { socialFeed: true }],
    ['the feed flag off', { attendeeDirectory: true, socialFeed: false }],
    ['the directory flag off', { attendeeDirectory: false, socialFeed: true }],
    ['a string flag', { attendeeDirectory: true, socialFeed: 'true' }],
    ['an empty document', {}],
  ])('asks nothing with %s', async (_name, features) => {
    renderFeed();
    await openFeedAs(makeUser('ada'), APPROVED, features);
    expect(listenersFor('social_posts')).toHaveLength(0);
  });

  it('asks nothing for a signed-out visitor or a pending account', async () => {
    renderFeed();
    pushDoc('config/features', FEED_ON);
    await act(async () => {});
    expect(listenersFor('social_posts')).toHaveLength(0);
    publishAuth(makeUser('bo'));
    pushDoc('users/bo', { uid: 'bo', ...PENDING });
    await act(async () => {});
    expect(listenersFor('social_posts')).toHaveLength(0);
    expect(await screen.findByText(/opens for you once your registration is approved/)).toBeInTheDocument();
  });

  it('asks for active roots, newest first, bounded, for an approved attendee', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const [feed] = activeFeedListeners();
    expect(feed.target.clauses).toEqual([
      { where: ['state', '==', 'active'] },
      { where: ['parentPostId', '==', null] },
      { orderBy: ['createdAt', 'desc'] },
      { limit: 20 },
    ]);
  });

  it('opens for a speaker and for an independent current staff grant with no account document', async () => {
    renderFeed();
    await openFeedAs(makeUser('spk'), { registrationStatus: 'pending', speakerId: 'speaker-1' });
    expect(activeFeedListeners()).toHaveLength(1);

    admins.add('staffer');
    publishAuth(makeUser('staffer'));
    pushDoc('users/staffer', null);
    await act(async () => {});
    expect(activeFeedListeners()).toHaveLength(1);
    expect(activeFeedListeners()[0]).not.toBe(listenersFor('social_posts')[0]);
  });
});

describe('account transitions', () => {
  it('approved A to pending B: hides A, cancels A, ignores A’s late callback, and asks nothing for B', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const feedA = activeFeedListeners()[0];
    pushPosts(feedA, [post('p1', 'ada', 'Ada’s post')]);
    expect(screen.getByText('Ada’s post')).toBeInTheDocument();

    renders = [];
    publishAuth(makeUser('bo'));
    expect(screen.queryByText('Ada’s post')).not.toBeInTheDocument();
    expect(feedA.active).toBe(false);
    // Not one render paired B with A's account document or A's verdict.
    for (const entry of renders.filter((item) => item.uid === 'bo')) {
      expect(entry.profileUid).toBeNull();
      expect(entry.adminStatus).not.toBe('admin');
    }

    pushPosts(feedA, [post('p1', 'ada', 'Ada’s post')]);
    pushDoc('users/bo', { uid: 'bo', ...PENDING });
    await act(async () => {});
    expect(screen.queryByText('Ada’s post')).not.toBeInTheDocument();
    expect(activeFeedListeners()).toHaveLength(0);
  });

  it('approved A to approved B: a new listener for B, A’s late callback and late report completion dropped', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const feedA = activeFeedListeners()[0];
    pushPosts(feedA, [post('p1', 'cy', 'Shared post')]);

    const pendingReport = deferred();
    vi.mocked(fetch).mockReturnValueOnce(pendingReport.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Report post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    publishAuth(makeUser('bo'));
    pushDoc('users/bo', { uid: 'bo', ...APPROVED });
    await act(async () => {});
    const feeds = activeFeedListeners();
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).not.toBe(feedA);
    expect(screen.queryByText('Shared post')).not.toBeInTheDocument();

    pushPosts(feedA, [post('p9', 'ada', 'Late for A')]);
    pushPosts(feeds[0], [post('p1', 'cy', 'Shared post')]);
    await act(async () => pendingReport.resolve({ ok: true, status: 201, json: async () => ({ postId: 'p1', reported: true }) }));

    expect(screen.queryByText('Late for A')).not.toBeInTheDocument();
    expect(screen.getByText('Shared post')).toBeInTheDocument();
    expect(screen.queryByText(/Reported\./)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report post' })).toBeInTheDocument();
  });

  it('offline switch: a cache-only answer for B shows none of A’s posts, and only a server answer is shown', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [post('p1', 'ada', 'Only for Ada')]);
    expect(screen.getByText('Only for Ada')).toBeInTheDocument();

    // Offline, an empty cached probe can read as "admin" for B.
    admins.add('bo');
    publishAuth(makeUser('bo'));
    pushDoc('users/bo', { uid: 'bo', ...PENDING });
    await act(async () => {});
    const feedB = activeFeedListeners()[0];
    pushPosts(feedB, [post('p1', 'ada', 'Only for Ada')], { fromCache: true });
    expect(screen.queryByText('Only for Ada')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Loading the attendee feed/ })).toBeInTheDocument();

    pushPosts(feedB, [post('p2', 'cy', 'Server answer for Bo')]);
    expect(screen.getByText('Server answer for Bo')).toBeInTheDocument();
  });

  it('listens for metadata changes, so an unchanged cached answer confirmed by the server is shown', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const feed = activeFeedListeners()[0];
    // The SDK emits a cache-to-server change with identical documents only
    // to a listener that asked for metadata changes.
    expect(feed.options).toEqual({ includeMetadataChanges: true });
    pushPosts(feed, [post('p1', 'cy', 'Same post')], { fromCache: true });
    expect(screen.queryByText('Same post')).not.toBeInTheDocument();
    pushPosts(feed, [post('p1', 'cy', 'Same post')]);
    expect(screen.getByText('Same post')).toBeInTheDocument();
  });

  it('a staff verdict for A cannot authorize B while B’s probe is in flight', async () => {
    admins.add('staffer');
    renderFeed();
    publishAuth(makeUser('staffer'));
    pushDoc('users/staffer', null);
    pushDoc('config/features', FEED_ON);
    await act(async () => {});
    expect(activeFeedListeners()).toHaveLength(1);

    const gate = deferred();
    probeGates.set('bo', gate);
    renders = [];
    publishAuth(makeUser('bo'));
    pushDoc('users/bo', { uid: 'bo', ...PENDING });
    await act(async () => {});
    expect(renders.filter((entry) => entry.uid === 'bo').every((entry) => entry.adminStatus === 'unknown')).toBe(true);
    expect(activeFeedListeners()).toHaveLength(0);
    expect(screen.getByRole('status', { name: /Loading the attendee feed/ })).toBeInTheDocument();

    await act(async () => gate.resolve());
    expect(activeFeedListeners()).toHaveLength(0);
    expect(screen.getByText(/opens for you once your registration is approved/)).toBeInTheDocument();
  });

  it.each([
    ['sign-out', () => publishAuth(null)],
    ['access revocation', () => pushDoc('users/ada', { uid: 'ada', registrationStatus: 'revoked', speakerId: null })],
    ['the feed flag turning off', () => pushDoc('config/features', { attendeeDirectory: true, socialFeed: false })],
    ['the directory flag turning off', () => pushDoc('config/features', { attendeeDirectory: false, socialFeed: true })],
    ['config/features being deleted', () => pushDoc('config/features', null)],
    ['the config/features listener failing', () => {
      const entry = listenersFor('config/features').filter((item) => item.active).at(-1);
      act(() => entry.error(Object.assign(new Error('offline'), { code: 'unavailable' })));
    }],
  ])('%s hides the feed and cancels its listener', async (_name, change) => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const feed = activeFeedListeners()[0];
    pushPosts(feed, [post('p1', 'ada', 'Visible post')]);
    expect(screen.getByText('Visible post')).toBeInTheDocument();

    change();
    await act(async () => {});
    expect(screen.queryByText('Visible post')).not.toBeInTheDocument();
    expect(feed.active).toBe(false);
    pushPosts(feed, [post('p2', 'ada', 'After the change')]);
    expect(screen.queryByText('After the change')).not.toBeInTheDocument();
  });
});

describe('what the feed shows', () => {
  it('names authors only from readable projections, never reads users, and drops replies and tombstones', async () => {
    projections.set('pub', { displayName: 'Pat Public', profileVisibility: 'public' });
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [
      post('p1', 'pub', 'From a public profile'),
      post('p2', 'priv', 'From a private profile'),
      post('r1', 'pub', 'A reply', { parentPostId: 'p1' }),
      { id: 'gone', state: 'removed', parentPostId: null, createdAt: new Date() },
    ]);

    const link = await screen.findByRole('link', { name: 'Pat Public' });
    expect(link).toHaveAttribute('href', '/attendees/pub');
    const privateItem = screen.getByText('From a private profile').closest('li');
    await waitFor(() => expect(getDoc).toHaveBeenCalledTimes(2));
    expect(within(privateItem).getByText('An attendee')).toBeInTheDocument();
    expect(within(privateItem).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('A reply')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(vi.mocked(getDoc).mock.calls.map(([target]) => pathOf(target)).sort())
      .toEqual(['users_public/priv', 'users_public/pub']);
  });

  it('renders post text as text', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [post('p1', 'ada', '<img src=x onerror="alert(1)"> hi')]);
    expect(screen.getByText('<img src=x onerror="alert(1)"> hi')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('states loading, empty, unavailable and refused', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    expect(screen.getByRole('status', { name: /Loading the attendee feed/ })).toBeInTheDocument();
    const feed = activeFeedListeners()[0];
    pushPosts(feed, []);
    expect(screen.getByRole('heading', { name: 'No posts yet' })).toBeInTheDocument();
    act(() => feed.error(Object.assign(new Error('offline'), { code: 'unavailable' })));
    expect(screen.getByRole('heading', { name: 'The feed is unavailable right now' })).toBeInTheDocument();
    act(() => feed.error(Object.assign(new Error('no'), { code: 'permission-denied' })));
    expect(screen.getByText(/opens for you once your registration is approved/)).toBeInTheDocument();
  });
});

describe('older posts', () => {
  it('pages past the newest posts with a bounded cursor fetch, keeps every loaded post live, and is not capped', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const newest = Array.from({ length: 20 }, (_, i) => post(`n${i}`, 'ada', `Newest ${i}`));
    const head = activeFeedListeners()[0];
    pushPosts(head, newest);

    // Each older page is the next 20 after the oldest loaded post.
    let previous = head;
    let shown = newest;
    for (let round = 0; round < 6; round += 1) {
      const page = Array.from({ length: 20 }, (_, i) => post(`o${round}-${i}`, 'ada', `Older ${round}-${i}`));
      olderPages.push(page);
      const oldest = previous.lastDocs.at(-1);
      fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
      await act(async () => {});
      const request = vi.mocked(getDocsFromServer).mock.calls.at(-1)[0];
      expect(pathOf(request)).toBe('social_posts');
      expect(request.clauses.slice(0, 3)).toEqual([
        { where: ['state', '==', 'active'] },
        { where: ['parentPostId', '==', null] },
        { orderBy: ['createdAt', 'desc'] },
      ]);
      expect(request.clauses[3].startAfter[0]).toBe(oldest);
      expect(request.clauses[4]).toEqual({ limit: 20 });

      const live = activeFeedListeners();
      expect(live).toHaveLength(1);
      expect(previous.active).toBe(false);
      expect(live[0].target.clauses[3].endAt[0].id).toBe(`o${round}-19`);
      shown = [...shown, ...page];
      pushPosts(live[0], shown);
      previous = live[0];
    }
    // 140 posts: past any fixed cap.
    expect(screen.getByText('Older 5-19')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Report post' })).toHaveLength(140);

    olderPages.push([post('last', 'ada', 'The very first post')]);
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    await act(async () => {});
    pushPosts(activeFeedListeners()[0], [...shown, post('last', 'ada', 'The very first post')]);
    expect(screen.getByText('The very first post')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older posts' })).not.toBeInTheDocument();
  });

  it('keeps "Show older posts" after a failed server fetch, so a retry can page on', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], Array.from({ length: 20 }, (_, i) => post(`n${i}`, 'ada', `Newest ${i}`)));
    olderPages.push(Object.assign(new Error('offline'), { code: 'unavailable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Older posts could not be loaded. Try again.');
    olderPages.push([post('o1', 'ada', 'An older post')]);
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    await act(async () => {});
    expect(getDocsFromServer).toHaveBeenCalledTimes(2);
    expect(activeFeedListeners()[0].target.clauses[3].endAt[0].id).toBe('o1');
  });

  it('pages on from the retained cursor when every loaded post was removed', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], Array.from({ length: 20 }, (_, i) => post(`n${i}`, 'ada', `Newest ${i}`)));
    olderPages.push(Array.from({ length: 20 }, (_, i) => post(`o${i}`, 'ada', `Older ${i}`)));
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    await act(async () => {});
    const ranged = activeFeedListeners()[0];
    const cursor = ranged.target.clauses[3].endAt[0];
    // An account cleanup removed every post in the loaded range.
    pushPosts(ranged, []);
    expect(screen.queryByRole('heading', { name: 'No posts yet' })).not.toBeInTheDocument();
    olderPages.push([post('x1', 'bo', 'Still here')]);
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    await act(async () => {});
    expect(vi.mocked(getDocsFromServer).mock.calls.at(-1)[0].clauses[3].startAfter[0]).toBe(cursor);
  });
});

describe('reporting a post', () => {
  it('confirms, sends only the post id once, offers a retry after a failure, and then confirms success', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [post('p1', 'cy', 'Report me')]);

    fireEvent.click(screen.getByRole('button', { name: 'Report post' }));
    expect(fetch).not.toHaveBeenCalled();
    const failed = deferred();
    vi.mocked(fetch).mockReturnValueOnce(failed.promise);
    const send = screen.getByRole('button', { name: 'Send report' });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => failed.resolve({
      ok: false, status: 500, json: async () => ({ error: { code: 'internal', message: 'The report could not be saved. Try again.' } }),
    }));
    expect(screen.getByRole('alert')).toHaveTextContent('The report could not be saved. Try again.');

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ postId: 'p1', reported: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Reported. Staff will review this post.')).toBeInTheDocument();

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(url).toBe('https://functions.example.test/reportSocialPost');
      expect(init.headers.Authorization).toBe('Bearer token-ada');
      expect(JSON.parse(init.body)).toEqual({ postId: 'p1' });
    }
  });

  it('does not bring back a report abandoned when access closed', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [post('p1', 'cy', 'Report me later')]);
    const pending = deferred();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Report post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    pushDoc('config/features', { attendeeDirectory: true, socialFeed: false });
    await act(async () => pending.resolve({ ok: false, status: 500, json: async () => ({}) }));
    pushDoc('config/features', FEED_ON);
    await act(async () => {});
    pushPosts(activeFeedListeners()[0], [post('p1', 'cy', 'Report me later')]);

    const button = screen.getByRole('button', { name: 'Report post' });
    expect(button).toBeEnabled();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ postId: 'p1', reported: true }) });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Reported. Staff will review this post.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('sends nothing when the reader cancels', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [post('p1', 'cy', 'Keep me')]);
    fireEvent.click(screen.getByRole('button', { name: 'Report post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Report post' })).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });
});
