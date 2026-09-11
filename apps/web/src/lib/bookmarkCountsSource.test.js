// lib/bookmarkCountsSource.js — the public aggregate counts (issue #165).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onSnapshotMock = vi.fn();
const collectionMock = vi.fn((_db, path) => ({ __kind: 'collection', path }));

vi.mock('firebase/firestore', () => ({
  collection: (...args) => collectionMock(...args),
  onSnapshot: (...args) => onSnapshotMock(...args),
}));
vi.mock('../firebase.js', () => ({ db: {} }));

const { subscribeBookmarkCounts } = await import('./bookmarkCountsSource.js');

describe('subscribeBookmarkCounts', () => {
  let detach;
  let activeUnsubs;

  function sub(onNext, onError) {
    const unsubscribe = subscribeBookmarkCounts(onNext, onError);
    activeUnsubs.push(unsubscribe);
    return unsubscribe;
  }

  beforeEach(() => {
    onSnapshotMock.mockReset();
    collectionMock.mockClear();
    detach = vi.fn();
    onSnapshotMock.mockImplementation(() => detach);
    activeUnsubs = [];
  });

  afterEach(() => {
    for (const unsubscribe of activeUnsubs) unsubscribe();
  });

  it('subscribes to the one public collection and hands back a map', () => {
    const onNext = vi.fn();
    sub(onNext);

    expect(collectionMock).toHaveBeenCalledWith({}, 'sessionBookmarks');
    expect(onSnapshotMock).toHaveBeenCalledTimes(1);

    const [, callback] = onSnapshotMock.mock.calls[0];
    callback({
      docs: [
        { id: 's1', data: () => ({ count: 3, updatedAt: 'x' }) },
        { id: 's2', data: () => ({ count: 0 }) },
      ],
    });
    expect(onNext).toHaveBeenCalledWith(
      new Map([
        ['s1', 3],
        ['s2', 0],
      ]),
    );
  });

  it('a count that is not a number reads as zero', () => {
    const onNext = vi.fn();
    sub(onNext);
    const [, callback] = onSnapshotMock.mock.calls[0];
    callback({
      docs: [
        { id: 's1', data: () => ({}) },
        { id: 's2', data: () => ({ count: 'many' }) },
        { id: 's3', data: () => ({ count: Number.NaN }) },
      ],
    });
    expect(onNext).toHaveBeenCalledWith(
      new Map([
        ['s1', 0],
        ['s2', 0],
        ['s3', 0],
      ]),
    );
  });

  it('an empty collection is an empty map, not a missing answer', () => {
    const onNext = vi.fn();
    sub(onNext);
    const [, callback] = onSnapshotMock.mock.calls[0];
    callback({ docs: [] });
    expect(onNext).toHaveBeenCalledWith(new Map());
  });

  it('a listener error reports to onError and never to onNext', () => {
    const onNext = vi.fn();
    const onError = vi.fn();
    sub(onNext, onError);
    const [, , errorCallbacks] = onSnapshotMock.mock.calls[0];
    const failure = new Error('denied');
    errorCallbacks(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onNext).not.toHaveBeenCalled();
    expect(detach).toBeDefined();
  });
});
