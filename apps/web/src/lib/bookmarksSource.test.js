import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onSnapshotMock = vi.fn();
const collectionMock = vi.fn((_db, path) => ({ __kind: 'collection', path }));

vi.mock('firebase/firestore', () => ({
  collection: (...args) => collectionMock(...args),
  onSnapshot: (...args) => onSnapshotMock(...args),
}));
vi.mock('../firebase.js', () => ({ db: {} }));
vi.mock('../contexts/AuthContext.jsx', () => ({
  functionsOrigin: () => 'https://fake-functions.example',
}));

const { BookmarkRequestError, setSessionBookmarked, subscribeMyBookmarks } = await import(
  './bookmarksSource.js'
);

describe('subscribeMyBookmarks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onSnapshotMock.mockReset();
    collectionMock.mockClear();
    onSnapshotMock.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to users/{uid}/bookmarks for a signed-in uid', () => {
    subscribeMyBookmarks('u1', vi.fn());
    expect(collectionMock).toHaveBeenCalledWith({}, 'users/u1/bookmarks');
  });

  it('maps snapshot docs to a Set of session ids', () => {
    let capturedSuccess;
    onSnapshotMock.mockImplementation((_target, onSuccess) => {
      capturedSuccess = onSuccess;
      return vi.fn();
    });
    const onNext = vi.fn();
    subscribeMyBookmarks('u1', onNext);
    capturedSuccess({ docs: [{ id: 's1' }, { id: 's2' }] });
    expect(onNext).toHaveBeenCalledWith(new Set(['s1', 's2']));
  });

  it('calls onNext with an empty set and subscribes to nothing when uid is falsy', () => {
    const onNext = vi.fn();
    const unsubscribe = subscribeMyBookmarks(undefined, onNext);
    expect(onNext).toHaveBeenCalledWith(new Set());
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('fails soft on a listener error (no throw, onNext not called again)', () => {
    let capturedError;
    onSnapshotMock.mockImplementation((_target, _onSuccess, onError) => {
      capturedError = onError;
      return vi.fn();
    });
    const onNext = vi.fn();
    subscribeMyBookmarks('u1', onNext);
    expect(() => capturedError(new Error('permission denied'))).not.toThrow();
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('setSessionBookmarked', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  function fakeUser(token = 'id-token') {
    return { getIdToken: vi.fn(async () => token) };
  }

  it('throws BookmarkRequestError (unauthorized) when there is no user, without calling fetch', async () => {
    await expect(
      setSessionBookmarked({ user: null, sessionId: 's1', bookmarked: true }),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to bookmarkSession with a bearer token and the desired state', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ bookmarked: true, count: 3 }),
    });
    const result = await setSessionBookmarked({ user: fakeUser(), sessionId: 's1', bookmarked: true });
    expect(result).toEqual({ bookmarked: true, count: 3 });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://fake-functions.example/bookmarkSession');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer id-token');
    expect(JSON.parse(opts.body)).toEqual({ sessionId: 's1', bookmarked: true });
  });

  it('throws BookmarkRequestError with the server error code/message on a non-2xx response', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'forbidden', message: 'Attendee access required.' } }),
    });
    await expect(
      setSessionBookmarked({ user: fakeUser(), sessionId: 's1', bookmarked: true }),
    ).rejects.toMatchObject({
      name: 'BookmarkRequestError',
      code: 'forbidden',
      status: 403,
      message: 'Attendee access required.',
    });
  });

  it('normalizes a network failure to a "network" BookmarkRequestError', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('fetch failed'));
    const err = await setSessionBookmarked({ user: fakeUser(), sessionId: 's1', bookmarked: true }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(BookmarkRequestError);
    expect(err.code).toBe('network');
  });
});
