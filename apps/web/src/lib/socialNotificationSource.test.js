import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDocsFromServerMock = vi.fn();
const onSnapshotMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  collection: (_db, ...segments) => ({ path: segments.join('/') }),
  documentId: () => '__name__',
  getDocsFromServer: (...args) => getDocsFromServerMock(...args),
  limit: (size) => ({ limit: size }),
  onSnapshot: (...args) => onSnapshotMock(...args),
  orderBy: (field, direction) => ({ orderBy: [field, direction] }),
  query: (ref, ...clauses) => ({ ref, clauses }),
  startAfter: (cursor) => ({ startAfter: cursor }),
}));
vi.mock('../firebase.js', () => ({ db: {} }));

const {
  loadSocialNotificationPage,
  markSocialNotificationRead,
  watchSocialNotifications,
} = await import('./socialNotificationSource.js');

const at = { toDate: () => new Date('2026-11-13T15:00:00.000Z') };
const row = (id, data = {}) => ({
  id,
  data: () => ({
    kind: 'post_reply',
    rootPostId: `root-${id}`,
    replyPostId: id,
    createdAt: at,
    readAt: null,
    ...data,
  }),
});

beforeEach(() => {
  getDocsFromServerMock.mockReset();
  onSnapshotMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('social notification reads', () => {
  it('uses the owner path and total order, omits malformed rows, and keeps the raw cursor', async () => {
    const docs = [row('reply-z'), row('reply-a')];
    for (let index = 0; index < 17; index += 1) docs.push(row(`reply-${index}`));
    const malformedLast = row('reply-last', { kind: 'other' });
    docs.push(malformedLast);
    getDocsFromServerMock.mockResolvedValue({ docs });

    const page = await loadSocialNotificationPage({ uid: 'owner-1' });

    const target = getDocsFromServerMock.mock.calls[0][0];
    expect(target.ref.path).toBe('users/owner-1/notifications');
    expect(target.clauses).toEqual([
      { orderBy: ['createdAt', 'desc'] },
      { orderBy: ['__name__', 'desc'] },
      { limit: 20 },
    ]);
    expect(page.items.slice(0, 2).map((item) => item.id)).toEqual(['reply-z', 'reply-a']);
    expect(page.items).toHaveLength(19);
    expect(page.items[0]).toEqual({
      id: 'reply-z', rootPostId: 'root-reply-z', replyId: 'reply-z', createdAt: at, readAt: null,
    });
    expect(page.cursor).toBe(malformedLast);
    expect(page.hasMore).toBe(true);

    getDocsFromServerMock.mockResolvedValue({ docs: [] });
    await loadSocialNotificationPage({ uid: 'owner-1', cursor: page.cursor });
    expect(getDocsFromServerMock.mock.calls[1][0].clauses).toEqual([
      { orderBy: ['createdAt', 'desc'] },
      { orderBy: ['__name__', 'desc'] },
      { startAfter: malformedLast },
      { limit: 20 },
    ]);
  });

  it('delivers only server-confirmed watch pages and reports the original listener error', () => {
    vi.useFakeTimers();
    const detach = vi.fn();
    let next;
    let fail;
    onSnapshotMock.mockImplementation((_target, _options, onNext, onError) => {
      next = onNext;
      fail = onError;
      return detach;
    });
    const onData = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const unsubscribe = watchSocialNotifications({ uid: 'owner-1', onData, onError });
    expect(onSnapshotMock.mock.calls[0][1]).toEqual({ includeMetadataChanges: true });
    next({ docs: [row('reply-1')], metadata: { fromCache: true } });
    expect(onData).not.toHaveBeenCalled();
    next({ docs: [row('reply-1')], metadata: { fromCache: false } });
    expect(onData).toHaveBeenCalledWith(expect.objectContaining({ hasMore: false }));

    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    fail(denied);
    expect(onError).toHaveBeenCalledWith(denied);
    unsubscribe();
    expect(detach).toHaveBeenCalledTimes(1);
  });
});

describe('markSocialNotificationRead', () => {
  it('sends only the read action and retains the server status and code on refusal', async () => {
    const send = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'not-found', message: 'This notification is not available.' } }),
    }));
    const user = { getIdToken: vi.fn(async () => 'owner-token') };

    const error = await markSocialNotificationRead({
      user,
      notificationId: 'reply-1',
      env: { VITE_FUNCTIONS_ORIGIN: 'https://functions.example.test/' },
      fetchImpl: send,
    }).catch((failure) => failure);

    expect(send).toHaveBeenCalledWith('https://functions.example.test/markSocialNotificationRead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner-token' },
      body: JSON.stringify({ notificationId: 'reply-1', action: 'read' }),
    });
    expect(error).toMatchObject({
      name: 'SocialNotificationRequestError', code: 'not-found', status: 404,
      message: 'This notification is not available.',
    });
  });
});
