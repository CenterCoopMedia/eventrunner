import { beforeEach, describe, expect, it, vi } from 'vitest';

// subscribeLiveUpdates runs TWO onSnapshot listeners — one for pinned rows
// (where pinned == true, uncapped-ish), one for the capped "recent" query —
// and merges them (Codex P2: a single orderBy+limit query can push an older
// PINNED row off the page once N newer unpinned rows land). Track calls in
// registration order so each test can address "the pinned listener" vs "the
// recent listener" by index.
const calls = [];
const onSnapshotMock = vi.fn((_target, onSuccess, onError) => {
  calls.push({ onSuccess, onError });
  return vi.fn();
});
const collectionMock = vi.fn((_db, name) => ({ __kind: 'collection', name }));
const whereMock = vi.fn((field, op, value) => ({ __kind: 'where', field, op, value }));
const orderByMock = vi.fn((field, dir) => ({ __kind: 'orderBy', field, dir }));
const limitMock = vi.fn((n) => ({ __kind: 'limit', n }));
const queryMock = vi.fn((base, ...constraints) => ({ __kind: 'query', base, constraints }));

vi.mock('firebase/firestore', () => ({
  collection: (...args) => collectionMock(...args),
  onSnapshot: (...args) => onSnapshotMock(...args),
  query: (...args) => queryMock(...args),
  where: (...args) => whereMock(...args),
  orderBy: (...args) => orderByMock(...args),
  limit: (...args) => limitMock(...args),
}));
vi.mock('../firebase.js', () => ({ db: {} }));

const { subscribeLiveUpdates } = await import('./liveUpdatesSource.js');

function doc(id, fields) {
  return { id, data: () => fields };
}

describe('subscribeLiveUpdates', () => {
  beforeEach(() => {
    calls.length = 0;
    whereMock.mockClear();
  });

  it('registers a pinned (where pinned == true) query and a capped recent query', () => {
    subscribeLiveUpdates(vi.fn());
    expect(whereMock).toHaveBeenCalledWith('pinned', '==', true);
    expect(calls.length).toBe(2);
  });

  it('does not drop an older pinned entry that falls outside the recent cap', () => {
    const onNext = vi.fn();
    subscribeLiveUpdates(onNext);
    const [pinned, recent] = calls;

    // An old pinned entry the "recent" query would never return, plus a
    // newer unpinned one that the recent query does return.
    pinned.onSuccess({ docs: [doc('old-pinned', { message: 'Old but pinned', pinned: true, postedAt: new Date(1000) })] });
    recent.onSuccess({ docs: [doc('new', { message: 'Newer', pinned: false, postedAt: new Date(9000) })] });

    expect(onNext).toHaveBeenCalledTimes(1);
    const ids = onNext.mock.calls[0][0].map((d) => d.id);
    expect(ids).toContain('old-pinned');
    expect(ids).toContain('new');
  });

  it('waits for both listeners to report before emitting', () => {
    const onNext = vi.fn();
    subscribeLiveUpdates(onNext);
    const [pinned] = calls;
    pinned.onSuccess({ docs: [] });
    expect(onNext).not.toHaveBeenCalled();
  });

  it('de-duplicates a row present in both queries and sorts newest first', () => {
    const onNext = vi.fn();
    subscribeLiveUpdates(onNext);
    const [pinned, recent] = calls;

    pinned.onSuccess({ docs: [doc('p1', { message: 'Pinned', pinned: true, postedAt: new Date(5000) })] });
    recent.onSuccess({
      docs: [
        doc('p1', { message: 'Pinned', pinned: true, postedAt: new Date(5000) }),
        doc('r1', { message: 'Recent', pinned: false, postedAt: new Date(9000) }),
      ],
    });

    const result = onNext.mock.calls[0][0];
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('r1'); // newest first
    expect(result[1].id).toBe('p1');
  });
});
