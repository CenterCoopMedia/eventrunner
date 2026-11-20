// The attendee feed at its boundaries (issue #788). The real
// EventConfigProvider, AuthProvider and ProfileProvider run; only the
// Firebase SDK calls and `fetch` are fakes. Expected values come from the
// #788 contract: no request until the live features document turns both
// flags on for a reader with a current grant; every account transition
// hides the previous reader's feed; active roots only; a safe author
// fallback; a report that sends only the post id, once per click.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { onAuthStateChanged } from 'firebase/auth';
import { getDoc, getDocFromServer, getDocs, getDocsFromServer, onSnapshot } from 'firebase/firestore';
import { auth } from '../firebase.js';
import { reloadPage } from '../lib/pageReload.js';

// The build snapshot turns the feed ON, so every "no request" case below
// also proves that a generated snapshot cannot open an unresolved feed.
vi.mock('@generated/eventConfig.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, features: { ...original.features, attendeeDirectory: true, socialFeed: true } };
});

// The thread page's closed state is the ordinary not-found page; its own
// tests cover it, and it needs the content provider this harness omits.
vi.mock('../pages/NotFound.jsx', () => ({ default: () => <p>Not found page</p> }));

const { EventConfigProvider } = await import('../contexts/EventConfigContext.jsx');
const { AuthProvider, useAuth } = await import('../contexts/AuthContext.jsx');
const { ProfileProvider, useProfile } = await import('../contexts/ProfileContext.jsx');
const { default: AttendeeFeed } = await import('./AttendeeFeed.jsx');
const { default: AttendeeThread } = await import('../pages/AttendeeThread.jsx');
const { default: PostComposer } = await import('./PostComposer.jsx');

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
/** UIDs whose admin probes answer from the offline cache. */
let cachedProbes;
/** users_public projections by uid; a missing uid is unreadable. */
let projections;
/** Pages the older-posts fetch returns, in order. */
let olderPages;

function pathOf(target) {
  if (Array.isArray(target?.path)) return target.path.join('/');
  if (typeof target?.ref?.path === 'string') return target.ref.path;
  return String(target?.path);
}

function docSnap(id, data, { fromCache = false } = {}) {
  return { id, exists: () => data != null, data: () => data, metadata: { fromCache } };
}

function listenersFor(path) {
  return listeners.filter((entry) => entry.path === path);
}

function activeFeedListeners() {
  return listenersFor('social_posts').filter((entry) => entry.active);
}

function pushDoc(path, data, options) {
  const entry = listenersFor(path).filter((item) => item.active).at(-1);
  if (!entry) throw new Error(`no live listener for ${path}`);
  act(() => entry.next(docSnap(path.split('/').at(-1), data, options)));
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

/**
 * Another account in this tab ends the page (issue 1017): only the switching
 * status shows, and the page reloads.
 */
function expectSwitching() {
  expect(screen.getByText('Switching accounts…')).toBeInTheDocument();
  expect(reloadPage).toHaveBeenCalledTimes(1);
}

/** Close this page and open a new one, as the next account in a new tab. */
function freshTab(view, open = renderFeed) {
  view.unmount();
  auth.currentUser = null;
  return open();
}

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

function renderThread(postId = 'root1') {
  return render(
    <EventConfigProvider>
      <AuthProvider>
        <ProfileProvider>
          <MemoryRouter initialEntries={[`/attendees/posts/${postId}`]}>
            <Routes>
              <Route path="/attendees/posts/:postId" element={<AttendeeThread />} />
            </Routes>
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
  vi.mocked(reloadPage).mockClear();
  vi.stubEnv('VITE_FUNCTIONS_ORIGIN', 'https://functions.example.test');
  vi.stubGlobal('fetch', vi.fn());
  listeners = [];
  admins = new Set();
  probeGates = new Map();
  cachedProbes = new Set();
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
    if (admins.has(uid)) return { docs: [], metadata: { fromCache: cachedProbes.has(uid) } };
    throw Object.assign(new Error(`denied ${pathOf(target)}`), { code: 'permission-denied' });
  });
  vi.mocked(getDoc).mockReset();
  vi.mocked(getDocFromServer).mockReset().mockImplementation(async (target) => {
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

  it('asks nothing while config/features is only a cached answer, and opens once the server confirms it', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'), APPROVED, FEED_ON);
    expect(activeFeedListeners()).toHaveLength(1);
    // A listener retry answers from the cache first.
    pushDoc('config/features', FEED_ON, { fromCache: true });
    await act(async () => {});
    expect(activeFeedListeners()).toHaveLength(0);
    expect(listenersFor('config/features').at(-1).options).toEqual({ includeMetadataChanges: true });
    pushDoc('config/features', FEED_ON);
    await act(async () => {});
    expect(activeFeedListeners()).toHaveLength(1);
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
    const view = renderFeed();
    await openFeedAs(makeUser('spk'), { registrationStatus: 'pending', speakerId: 'speaker-1' });
    expect(activeFeedListeners()).toHaveLength(1);

    freshTab(view);
    admins.add('staffer');
    publishAuth(makeUser('staffer'));
    pushDoc('users/staffer', null);
    pushDoc('config/features', FEED_ON);
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
    expectSwitching();
    // No render carried B: the page ends before B is published.
    expect(renders).toEqual([]);

    pushPosts(feedA, [post('p1', 'ada', 'Ada’s post')]);
    expect(listenersFor('users/bo')).toHaveLength(0);
    await act(async () => {});
    expect(screen.queryByText('Ada’s post')).not.toBeInTheDocument();
    expect(activeFeedListeners()).toHaveLength(0);
    expect(listenersFor('users/bo')).toHaveLength(0);
  });

  it('approved A to approved B: no listener for B, A’s late callback and late report completion dropped', async () => {
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
    expect(listenersFor('users/bo')).toHaveLength(0);
    await act(async () => {});
    expectSwitching();
    expect(feedA.active).toBe(false);
    expect(activeFeedListeners()).toHaveLength(0);
    expect(screen.queryByText('Shared post')).not.toBeInTheDocument();

    pushPosts(feedA, [post('p9', 'ada', 'Late for A')]);
    await act(async () => pendingReport.resolve({ ok: true, status: 201, json: async () => ({ postId: 'p1', reported: true }) }));
    expect(screen.queryByText('Late for A')).not.toBeInTheDocument();
    expect(screen.queryByText(/Reported\./)).not.toBeInTheDocument();
  });

  it('offline switch: B gets no admin probe and never sees A’s posts', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [post('p1', 'ada', 'Only for Ada')]);
    expect(screen.getByText('Only for Ada')).toBeInTheDocument();

    // Offline, an empty cached probe would read as "admin" for B.
    admins.add('bo');
    cachedProbes.add('bo');
    const probes = vi.mocked(getDocs).mock.calls.length;
    publishAuth(makeUser('bo'));
    expect(listenersFor('users/bo')).toHaveLength(0);
    await act(async () => {});
    expectSwitching();
    expect(vi.mocked(getDocs).mock.calls.length).toBe(probes);
    expect(activeFeedListeners()).toHaveLength(0);
    expect(screen.queryByText('Only for Ada')).not.toBeInTheDocument();
  });

  it('a staff reader whose probe answered from the cache opens the feed once the browser reconnects', async () => {
    admins.add('staffer');
    cachedProbes.add('staffer');
    renderFeed();
    await openFeedAs(makeUser('staffer'), PENDING);
    expect(listenersFor('social_posts')).toHaveLength(0);
    expect(screen.getByText(/Loading the attendee feed/, { selector: '.loading-status__label' })).toBeInTheDocument();

    cachedProbes.delete('staffer');
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await act(async () => {});
    expect(activeFeedListeners()).toHaveLength(1);
  });

  it('a cached approved account document opens nothing until the server confirms the grant', async () => {
    renderFeed();
    publishAuth(makeUser('ada'));
    pushDoc('config/features', FEED_ON);
    // Approved at an earlier sign-in, revoked since: the cache still says approved.
    pushDoc('users/ada', { uid: 'ada', ...APPROVED }, { fromCache: true });
    await act(async () => {});
    expect(listenersFor('social_posts')).toHaveLength(0);
    pushDoc('users/ada', { uid: 'ada', registrationStatus: 'revoked', speakerId: null });
    await act(async () => {});
    expect(listenersFor('social_posts')).toHaveLength(0);
    expect(screen.getByText(/opens for you once your registration is approved/)).toBeInTheDocument();
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

  it('a staff verdict for A cannot authorize B', async () => {
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
    expect(listenersFor('users/bo')).toHaveLength(0);
    await act(async () => {});
    expectSwitching();
    expect(renders).toEqual([]);
    expect(activeFeedListeners()).toHaveLength(0);

    await act(async () => gate.resolve());
    expect(activeFeedListeners()).toHaveLength(0);
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
  it('names authors only from server reads of readable projections, never reads users, and drops replies and tombstones', async () => {
    projections.set('pub', { displayName: 'Pat Public', profileVisibility: 'public' });
    // A private projection this reader may read (as staff, or as its owner).
    projections.set('hidden', { displayName: 'Hidden Name', profileVisibility: 'private' });
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [
      post('p1', 'pub', 'From a public profile'),
      post('p2', 'priv', 'From a private profile'),
      post('p3', 'hidden', 'From a readable private profile'),
      post('r1', 'pub', 'A reply', { parentPostId: 'p1' }),
      { id: 'gone', state: 'removed', parentPostId: null, createdAt: new Date() },
    ]);

    const link = await screen.findByRole('link', { name: 'Pat Public' });
    expect(link).toHaveAttribute('href', '/attendees/pub');
    const privateItem = screen.getByText('From a private profile').closest('li');
    await waitFor(() => expect(getDocFromServer).toHaveBeenCalledTimes(3));
    expect(within(privateItem).getByText('An attendee')).toBeInTheDocument();
    // No profile link: the one link is the thread's.
    expect(within(privateItem).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/attendees/posts/p2']);
    expect(screen.queryByText('A reply')).not.toBeInTheDocument();
    const readablePrivate = screen.getByText('From a readable private profile').closest('li');
    expect(within(readablePrivate).getByText('An attendee')).toBeInTheDocument();
    expect(within(readablePrivate).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/attendees/posts/p3']);
    expect(screen.queryByText('Hidden Name')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(vi.mocked(getDocFromServer).mock.calls.map(([target]) => pathOf(target)).sort())
      .toEqual(['users_public/hidden', 'users_public/priv', 'users_public/pub']);
    // Server reads only: a cached projection may belong to a previous reader.
    expect(getDoc).not.toHaveBeenCalled();
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
    expect(screen.getByText(/Loading the attendee feed/, { selector: '.loading-status__label' })).toBeInTheDocument();
    const feed = activeFeedListeners()[0];
    pushPosts(feed, []);
    expect(screen.getByRole('heading', { name: 'No posts yet' })).toBeInTheDocument();
    act(() => feed.error(Object.assign(new Error('offline'), { code: 'unavailable' })));
    expect(screen.getByRole('heading', { name: 'The feed is unavailable right now' })).toBeInTheDocument();
    act(() => feed.error(Object.assign(new Error('no'), { code: 'permission-denied' })));
    // An approved reader refused by the rules: the ticket grant (#1006, #1007).
    expect(screen.getByText(/Your ticket does not include the attendee feed, or your access is updating/)).toBeInTheDocument();
    expect(screen.queryByText(/opens for you once your registration is approved/)).not.toBeInTheDocument();
    // The listener retries; a granted answer opens the feed again.
    pushPosts(feed, []);
    expect(screen.getByRole('heading', { name: 'No posts yet' })).toBeInTheDocument();
  });

  // Changed for #1006: a read refusal can now be a ticket grant sweep, so the
  // same reader's draft is kept in memory and returns with the feed.
  it('hides the composer and ignores a late send on a feed refusal, and returns the same reader\'s draft', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const feed = activeFeedListeners()[0];
    pushPosts(feed, []);
    const pending = deferred();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const field = await screen.findByRole('textbox', { name: 'Write a post' });
    type(field, 'Private draft');
    fireEvent.click(screen.getByRole('button', { name: 'Post', exact: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    act(() => feed.error(Object.assign(new Error('refused'), { code: 'permission-denied' })));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Private draft')).not.toBeInTheDocument();
    act(() => feed.error(Object.assign(new Error('offline'), { code: 'unavailable' })));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await act(async () => pending.resolve(answer(201, { postId: 'late', state: 'active' })));
    expect(screen.queryByText('Posted. Your post is at the top of the feed.')).not.toBeInTheDocument();

    pushPosts(feed, []);
    expect(await screen.findByRole('textbox', { name: 'Write a post' })).toHaveValue('Private draft');
  });

  it('never shows a kept draft to another account after the tab reloads', async () => {
    let view = renderFeed();
    await openFeedAs(makeUser('ada'));
    const feed = activeFeedListeners()[0];
    pushPosts(feed, []);
    type(await screen.findByRole('textbox', { name: 'Write a post' }), 'Ada only');
    act(() => feed.error(Object.assign(new Error('refused'), { code: 'permission-denied' })));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    view = freshTab(view);
    await openFeedAs(makeUser('bo'));
    pushPosts(activeFeedListeners().at(-1), []);
    expect(await screen.findByRole('textbox', { name: 'Write a post' })).toHaveValue('');
    expect(screen.queryByDisplayValue('Ada only')).not.toBeInTheDocument();

    freshTab(view);
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners().at(-1), []);
    expect(await screen.findByRole('textbox', { name: 'Write a post' })).toHaveValue('');
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

  it('pages from the fetched cursor when clicked again before the new listener answers', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], Array.from({ length: 20 }, (_, i) => post(`n${i}`, 'ada', `Newest ${i}`)));
    olderPages.push(Array.from({ length: 20 }, (_, i) => post(`o${i}`, 'ada', `Older ${i}`)));
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    await act(async () => {});
    const cursor = activeFeedListeners()[0].target.clauses[3].endAt[0];
    expect(cursor.id).toBe('o19');
    // The new listener has not answered yet; the old range is still shown.
    olderPages.push([post('z1', 'ada', 'Oldest')]);
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    await act(async () => {});
    expect(vi.mocked(getDocsFromServer).mock.calls.at(-1)[0].clauses[3].startAfter[0]).toBe(cursor);
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

  it('states a ticket refusal of a report in the feed words (issue 1007)', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [post('p1', 'cy', 'Report me')]);
    fireEvent.click(screen.getByRole('button', { name: 'Report post' }));
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 403,
      json: async () => ({ error: { code: 'ticket-resource', message: 'Your ticket does not include this part of the event.' } }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your ticket does not include the attendee feed.');
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

// --- Composer and thread (issue #511) ---------------------------------------

function createBodies() {
  return vi.mocked(fetch).mock.calls
    .filter(([url]) => String(url).endsWith('/createSocialPost'))
    .map(([, init]) => JSON.parse(init.body));
}

function answer(status, body) {
  return { ok: status < 300, status, json: async () => body };
}

function replyListener(rootId = 'root1') {
  return activeFeedListeners().find((entry) => entry.target.clauses?.[0]?.where?.[2] === rootId);
}

function type(field, value) {
  fireEvent.change(field, { target: { value } });
}

describe('the post composer', () => {
  it('opens for an approved attendee and a speaker, never for a staff grant alone or a pending account', async () => {
    let view = renderFeed();
    await openFeedAs(makeUser('ada'));
    expect(await screen.findByRole('textbox', { name: 'Write a post' })).toBeInTheDocument();

    view = freshTab(view);
    await openFeedAs(makeUser('spk'), { registrationStatus: 'pending', speakerId: 'speaker-1' });
    expect(await screen.findByRole('textbox', { name: 'Write a post' })).toBeInTheDocument();

    view = freshTab(view);
    await openFeedAs(makeUser('bo'), PENDING);
    expect(screen.queryByRole('textbox', { name: 'Write a post' })).not.toBeInTheDocument();

    freshTab(view);
    admins.add('staffer');
    publishAuth(makeUser('staffer'));
    pushDoc('users/staffer', null);
    pushDoc('config/features', FEED_ON);
    await act(async () => {});
    pushPosts(activeFeedListeners()[0], [post('p1', 'cy', 'Staff can read this')]);
    await act(async () => {});
    expect(screen.getByText('Staff can read this')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Write a post' })).not.toBeInTheDocument();
    expect(screen.queryByText('Loading the post form…')).not.toBeInTheDocument();
  });

  it('refuses blank and over-limit text in the form, keeps the draft, and moves focus to the field', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const field = await screen.findByRole('textbox', { name: 'Write a post' });
    type(field, '   ');
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Write something before you send.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();

    const long = 'x'.repeat(2001);
    type(field, long);
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Shorten the text to 2,000 characters or fewer. It has 2,001.')).toBeInTheDocument();
    expect(field).toHaveValue(long);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries a dropped answer under the same key, posts once, and takes a new key for new text', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const field = await screen.findByRole('textbox', { name: 'Write a post' });
    type(field, '  Hello <b>all</b>  ');
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network'));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/was not confirmed/);
    expect(alert).toHaveFocus();
    expect(field).toHaveValue('  Hello <b>all</b>  ');

    vi.mocked(fetch).mockResolvedValueOnce(answer(201, { postId: 'new1', state: 'active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Posted. Your post is at the top of the feed.')).toBeInTheDocument();
    expect(field).toHaveValue('');

    const [first, second] = createBodies();
    expect(first).toEqual({ text: 'Hello <b>all</b>', submissionKey: first.submissionKey });
    expect(first.submissionKey).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(second).toEqual(first);
    expect(vi.mocked(fetch).mock.calls[0][1].headers.Authorization).toBe('Bearer token-ada');

    type(field, 'Hello <b>all</b>');
    vi.mocked(fetch).mockResolvedValueOnce(answer(201, { postId: 'new2', state: 'active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(createBodies()).toHaveLength(3));
    expect(createBodies()[2].submissionKey).not.toBe(first.submissionKey);
  });

  it('states access updating or not included on a refused post and keeps the text (issue 1007)', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const field = await screen.findByRole('textbox', { name: 'Write a post' });
    type(field, 'Hello from a day pass');
    vi.mocked(fetch).mockResolvedValueOnce(answer(403, { error: { code: 'access-updating', message: 'x' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access updating. Try again in a few minutes. Your text is kept.');
    expect(field).toHaveValue('Hello from a day pass');

    vi.mocked(fetch).mockResolvedValueOnce(answer(403, { error: { code: 'ticket-resource', message: 'x' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your ticket does not include the attendee feed. Your text is kept.'));
    expect(field).toHaveValue('Hello from a day pass');

    vi.mocked(fetch).mockResolvedValueOnce(answer(403, { error: { code: 'forbidden', message: 'x' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Posting is open to approved attendees and speakers.'));
  });

  it('sends once while a request runs', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const field = await screen.findByRole('textbox', { name: 'Write a post' });
    type(field, 'Once');
    const pending = deferred();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const button = screen.getByRole('button', { name: 'Post' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Sending…');
    await act(async () => pending.resolve(answer(201, { postId: 'n', state: 'active' })));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(button).toBeEnabled();
  });

  it('a removed answer drops the key, keeps the text, explains it, and never resends on its own', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const field = await screen.findByRole('textbox', { name: 'Write a post' });
    type(field, 'Again');
    vi.mocked(fetch).mockResolvedValueOnce(answer(410, { error: { code: 'post-removed', message: 'gone' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Event staff removed the post you sent earlier/);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(field).toHaveValue('Again');

    vi.mocked(fetch).mockResolvedValueOnce(answer(201, { postId: 'n', state: 'active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(createBodies()).toHaveLength(2));
    const [first, second] = createBodies();
    expect(second.submissionKey).not.toBe(first.submissionKey);
  });

  it('completes a send under Strict Mode, which runs effect setup twice', async () => {
    render(
      <StrictMode>
        <PostComposer user={makeUser('ada')} />
      </StrictMode>,
    );
    type(screen.getByRole('textbox', { name: 'Write a post' }), 'Strict');
    vi.mocked(fetch).mockResolvedValueOnce(answer(201, { postId: 'n', state: 'active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Posted. Your post is at the top of the feed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled();
  });

  it('discards a draft only on request', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const field = await screen.findByRole('textbox', { name: 'Write a post' });
    type(field, 'Never mind');
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
    expect(screen.getByText('Draft discarded.')).toBeInTheDocument();
  });

  it('approved A to approved B: A’s draft is gone at the switch and A’s late answer is ignored', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    const field = await screen.findByRole('textbox', { name: 'Write a post' });
    type(field, 'Ada draft');
    const pending = deferred();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));

    publishAuth(makeUser('cy'));
    expect(screen.queryByDisplayValue('Ada draft')).not.toBeInTheDocument();
    expectSwitching();
    expect(listenersFor('users/cy')).toHaveLength(0);
    await act(async () => {});
    await act(async () => pending.resolve(answer(201, { postId: 'n', state: 'active' })));
    expect(screen.queryByText(/Posted\./)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Ada draft')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Write a post' })).not.toBeInTheDocument();
  });
});

describe('post text', () => {
  it('links only canonical absolute http(s) tokens, through the new-tab link, and leaves the rest as text', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [
      post('p1', 'cy', 'See HTTPS://Example.ORG/a?b=1. Not javascript:alert(1) or https:example.org or <b>bold</b>'),
    ]);
    const link = screen.getByRole('link', { name: 'HTTPS://Example.ORG/a?b=1 (opens in a new tab)' });
    expect(link).toHaveAttribute('href', 'https://example.org/a?b=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    const item = link.closest('li');
    expect(within(item).getAllByRole('link').map((a) => a.getAttribute('href')))
      .toEqual(['https://example.org/a?b=1', '/attendees/posts/p1']);
    expect(item).toHaveTextContent('. Not javascript:alert(1) or https:example.org or <b>bold</b>');
    expect(item.querySelector('b')).toBeNull();
  });

  it('keeps balanced brackets in a URL and leaves an unbalanced closer to the sentence', async () => {
    renderFeed();
    await openFeedAs(makeUser('ada'));
    pushPosts(activeFeedListeners()[0], [
      post('p1', 'cy', 'Read https://en.wikipedia.org/wiki/Function_(mathematics). (Or https://example.org/a).'),
    ]);
    expect(screen.getByRole('link', { name: 'https://en.wikipedia.org/wiki/Function_(mathematics) (opens in a new tab)' }))
      .toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Function_(mathematics)');
    expect(screen.getByRole('link', { name: 'https://example.org/a (opens in a new tab)' }))
      .toHaveAttribute('href', 'https://example.org/a');
  });
});

describe('the thread page', () => {
  it('shows neutral loading through auth and config startup without private reads', async () => {
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, listener) => {
      authListener = listener;
      return () => {};
    });
    renderThread();
    expect(screen.getByText('Loading…', { selector: '.loading-status__label' })).toBeInTheDocument();
    expect(screen.queryByText('Not found page')).not.toBeInTheDocument();
    expect(listenersFor('social_posts')).toHaveLength(0);
    expect(listenersFor('social_posts/root1')).toHaveLength(0);

    publishAuth(makeUser('ada'));
    pushDoc('users/ada', { uid: 'ada', ...APPROVED });
    pushDoc('config/features', FEED_ON, { fromCache: true });
    await act(async () => {});
    expect(screen.getByText('Loading…', { selector: '.loading-status__label' })).toBeInTheDocument();
    expect(screen.queryByText('Not found page')).not.toBeInTheDocument();
    expect(listenersFor('social_posts')).toHaveLength(0);
    expect(listenersFor('social_posts/root1')).toHaveLength(0);

    pushDoc('config/features', FEED_ON);
    expect(listenersFor('social_posts/root1')).toHaveLength(1);
    expect(replyListener()).toBeDefined();
  });

  it.each(['disabled', 'missing', 'failed'])('keeps %s feature startup at not-found even before auth resolves', (state) => {
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, listener) => {
      authListener = listener;
      return () => {};
    });
    renderThread();
    if (state === 'failed') {
      act(() => listenersFor('config/features').at(-1).error(Object.assign(new Error('offline'), { code: 'unavailable' })));
    } else {
      pushDoc('config/features', state === 'missing' ? null : { attendeeDirectory: true, socialFeed: false });
    }
    expect(screen.getByText('Not found page')).toBeInTheDocument();
    expect(listenersFor('social_posts')).toHaveLength(0);
    expect(listenersFor('social_posts/root1')).toHaveLength(0);
  });

  it('keeps a signed-out thread at not-found even with both features on', () => {
    renderThread();
    pushDoc('config/features', FEED_ON);
    expect(screen.getByText('Not found page')).toBeInTheDocument();
    expect(listenersFor('social_posts')).toHaveLength(0);
    expect(listenersFor('social_posts/root1')).toHaveLength(0);
  });

  it('is the not-found page while the feed is closed, and asks for nothing', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'), APPROVED, { attendeeDirectory: true, socialFeed: false });
    expect(screen.getByText('Not found page')).toBeInTheDocument();
    expect(listenersFor('social_posts')).toHaveLength(0);
    expect(listenersFor('social_posts/root1')).toHaveLength(0);
  });

  it('reads the live root and a bounded page of replies, oldest first', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    const [root] = listenersFor('social_posts/root1');
    expect(root.options).toEqual({ includeMetadataChanges: true });
    expect(replyListener().target.clauses).toEqual([
      { where: ['parentPostId', '==', 'root1'] },
      { orderBy: ['createdAt', 'asc'] },
      { limit: 50 },
    ]);
  });

  it('an active thread: Report on every entry, removed replies as placeholders, and a reply that names its parent', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    pushDoc('social_posts/root1', post('root1', 'cy', 'Root text'));
    pushPosts(replyListener(), [
      post('r1', 'cy', 'First reply', { parentPostId: 'root1' }),
      { id: 'r2', state: 'removed', parentPostId: 'root1', createdAt: new Date() },
    ]);
    expect(screen.getByText('Root text')).toBeInTheDocument();
    expect(screen.getByText('First reply')).toBeInTheDocument();
    expect(screen.getByText('Reply removed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Report post' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Back to the attendee feed' })).toHaveAttribute('href', '/attendees');
    expect(document.title).not.toMatch(/Root text/);

    const field = await screen.findByRole('textbox', { name: 'Your reply' });
    type(field, 'My reply');
    vi.mocked(fetch).mockResolvedValueOnce(answer(201, { postId: 'r3', state: 'active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));
    expect(await screen.findByText('Reply posted.')).toBeInTheDocument();
    expect(createBodies()[0]).toEqual({ text: 'My reply', parentPostId: 'root1', submissionKey: createBodies()[0].submissionKey });
  });

  it('pages by a bounded count, and a later reply still arrives after the last page', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    pushDoc('social_posts/root1', post('root1', 'cy', 'Root text'));
    const replies = (n) => Array.from({ length: n }, (_, i) => post(`r${String(i).padStart(3, '0')}`, 'cy', `Reply ${i}`, { parentPostId: 'root1' }));
    pushPosts(replyListener(), replies(50));
    fireEvent.click(screen.getByRole('button', { name: 'Show more replies' }));
    expect(replyListener().target.clauses.at(-1)).toEqual({ limit: 100 });
    expect(screen.getByText('Reply 49')).toBeInTheDocument();
    pushPosts(replyListener(), replies(51));
    expect(screen.getByText('Reply 50')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more replies' })).not.toBeInTheDocument();
    // Another attendee replies after the end was reached.
    pushPosts(replyListener(), replies(52));
    expect(screen.getByText('Reply 51')).toBeInTheDocument();
  });

  it('keeps the thread and the reply draft through a recoverable listener failure', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    pushDoc('social_posts/root1', post('root1', 'cy', 'Root text'));
    pushPosts(replyListener(), []);
    const field = await screen.findByRole('textbox', { name: 'Your reply' });
    type(field, 'Unsent reply');
    act(() => replyListener().error(Object.assign(new Error('offline'), { code: 'unavailable' })));
    expect(screen.getByText('The thread stopped updating. The page keeps trying in the background.')).toBeInTheDocument();
    expect(screen.getByText('Root text')).toBeInTheDocument();
    expect(field).toBeInTheDocument();
    expect(field).toHaveValue('Unsent reply');
  });

  it('keeps the same reader\'s reply draft through a thread refusal and sends nothing while refused', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    pushDoc('social_posts/root1', post('root1', 'cy', 'Root text'));
    pushPosts(replyListener(), []);
    type(await screen.findByRole('textbox', { name: 'Your reply' }), 'Reply kept');
    const replies = replyListener();
    act(() => replies.error(Object.assign(new Error('refused'), { code: 'permission-denied' })));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    pushPosts(replies, []);
    expect(await screen.findByRole('textbox', { name: 'Your reply' })).toHaveValue('Reply kept');
  });

  it('a refusal clears the thread and stays a refusal through a later recoverable failure', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    pushDoc('social_posts/root1', post('root1', 'cy', 'Root text'));
    pushPosts(replyListener(), [post('r1', 'cy', 'A reply', { parentPostId: 'root1' })]);
    const replies = replyListener();
    act(() => replies.error(Object.assign(new Error('refused'), { code: 'permission-denied' })));
    expect(screen.queryByText('A reply')).not.toBeInTheDocument();
    expect(screen.queryByText('Root text')).not.toBeInTheDocument();
    act(() => replies.error(Object.assign(new Error('offline'), { code: 'unavailable' })));
    expect(screen.queryByText('A reply')).not.toBeInTheDocument();
    expect(screen.queryByText('Root text')).not.toBeInTheDocument();
    // An approved reader refused by the rules: the ticket grant (#1006, #1007).
    expect(screen.getByText(/Your ticket does not include the attendee feed, or your access is updating/)).toBeInTheDocument();
  });

  it('a removed root shows "Original post removed", keeps replies readable and reportable, and closes replies', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    pushDoc('social_posts/root1', { state: 'removed', parentPostId: null, createdAt: new Date() });
    pushPosts(replyListener(), [post('r1', 'cy', 'Still here', { parentPostId: 'root1' })]);
    expect(screen.getByText('Original post removed')).toBeInTheDocument();
    expect(screen.getByText('Still here')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Report post' })).toHaveLength(1);
    expect(screen.getByText('Replies are closed because the original post was removed.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('a missing root reads the same as a removed one', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    pushDoc('social_posts/root1', null);
    pushPosts(replyListener(), []);
    expect(screen.getByText('Original post removed')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('clears a cached root and closes replies after an ambiguous server refusal until the root is confirmed', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    pushDoc('social_posts/root1', post('root1', 'cy', 'Root text'));
    pushPosts(replyListener(), []);
    const root = listenersFor('social_posts/root1').at(-1);
    act(() => root.error(Object.assign(new Error('offline'), { code: 'unavailable' })));
    const field = await screen.findByRole('textbox', { name: 'Your reply' });
    type(field, 'Too late');
    vi.mocked(fetch).mockResolvedValueOnce(answer(404, { error: { code: 'not-found', message: 'x' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));
    expect(await screen.findByText('Replies are closed right now.')).toBeInTheDocument();
    expect(screen.getByText('Original post unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Root text')).not.toBeInTheDocument();
    expect(screen.queryByText('Original post removed')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    pushDoc('social_posts/root1', null);
    expect(screen.getByText('Original post removed')).toBeInTheDocument();
    expect(screen.getByText('Replies are closed because the original post was removed.')).toBeInTheDocument();
  });

  it('a staff grant alone reads and reports but cannot reply', async () => {
    admins.add('staffer');
    renderThread();
    publishAuth(makeUser('staffer'));
    pushDoc('users/staffer', null);
    pushDoc('config/features', FEED_ON);
    await act(async () => {});
    pushDoc('social_posts/root1', post('root1', 'cy', 'Root text'));
    pushPosts(replyListener(), []);
    expect(screen.getByRole('button', { name: 'Report post' })).toBeInTheDocument();
    expect(screen.getByText('Replies are open to approved attendees and speakers.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('approved A to approved B: A’s thread is gone at the switch and A’s late callbacks are dropped', async () => {
    renderThread();
    await openFeedAs(makeUser('ada'));
    const rootA = listenersFor('social_posts/root1').at(-1);
    const repliesA = replyListener();
    pushDoc('social_posts/root1', post('root1', 'cy', 'Root text'));
    pushPosts(repliesA, [post('r1', 'cy', 'A reply', { parentPostId: 'root1' })]);
    const field = await screen.findByRole('textbox', { name: 'Your reply' });
    type(field, 'Ada reply draft');

    publishAuth(makeUser('bo'));
    expect(screen.queryByText('Root text')).not.toBeInTheDocument();
    expect(screen.queryByText('A reply')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Ada reply draft')).not.toBeInTheDocument();
    expect(rootA.active).toBe(false);
    expect(repliesA.active).toBe(false);
    expectSwitching();

    act(() => rootA.next(docSnap('root1', post('root1', 'cy', 'Root text'))));
    pushPosts(repliesA, [post('r1', 'cy', 'A reply', { parentPostId: 'root1' })]);
    expect(listenersFor('users/bo')).toHaveLength(0);
    await act(async () => {});
    expect(screen.queryByText('Root text')).not.toBeInTheDocument();
    expect(listenersFor('social_posts/root1').filter((entry) => entry.active)).toHaveLength(0);
  });
});
