import { beforeEach, describe, expect, it, vi } from 'vitest';

// subscribeContentCollection's one seam to Firestore is
// onSnapshot(query(collection(db, ...), where(...))) for published reads and
// onSnapshot(collection(db, `${name}_drafts`)) for draft reads. The
// visible == true where-clause on published reads is load-bearing (rules
// only allow anonymous reads of provably-visible docs, per the comment in
// contentSource.js) — pin the exact collection name and query constraints
// passed to the SDK so deleting the clause, or swapping the two branches,
// fails a test instead of failing silently in production.
const onSnapshotMock = vi.fn();
const collectionMock = vi.fn((_db, name) => ({ __kind: 'collection', name }));
const whereMock = vi.fn((field, op, value) => ({ __kind: 'where', field, op, value }));
const queryMock = vi.fn((base, ...constraints) => ({ __kind: 'query', base, constraints }));

vi.mock('firebase/firestore', () => ({
  collection: (...args) => collectionMock(...args),
  onSnapshot: (...args) => onSnapshotMock(...args),
  query: (...args) => queryMock(...args),
  where: (...args) => whereMock(...args),
}));
vi.mock('../firebase.js', () => ({ db: {} }));

const { subscribeContentCollection } = await import('./contentSource.js');

describe('subscribeContentCollection', () => {
  beforeEach(() => {
    onSnapshotMock.mockReset();
    collectionMock.mockClear();
    whereMock.mockClear();
    queryMock.mockClear();
    onSnapshotMock.mockImplementation(() => vi.fn());
  });

  it('published: queries the bare collection name with a visible == true where clause', () => {
    subscribeContentCollection('cmsContent', 'published', vi.fn());

    expect(collectionMock).toHaveBeenCalledWith({}, 'cmsContent');
    expect(whereMock).toHaveBeenCalledWith('visible', '==', true);
    expect(queryMock).toHaveBeenCalledWith(
      { __kind: 'collection', name: 'cmsContent' },
      { __kind: 'where', field: 'visible', op: '==', value: true },
    );
    const [target] = onSnapshotMock.mock.calls[0];
    expect(target.__kind).toBe('query');
  });

  it('draft: queries the `<name>_drafts` collection with no where clause', () => {
    subscribeContentCollection('cmsContent', 'draft', vi.fn());

    expect(collectionMock).toHaveBeenCalledWith({}, 'cmsContent_drafts');
    expect(whereMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    const [target] = onSnapshotMock.mock.calls[0];
    expect(target).toEqual({ __kind: 'collection', name: 'cmsContent_drafts' });
  });

  it('maps snapshot docs to { id, ...data } and calls onNext', () => {
    let capturedSuccess;
    onSnapshotMock.mockImplementation((_target, onSuccess) => {
      capturedSuccess = onSuccess;
      return vi.fn();
    });

    const onNext = vi.fn();
    subscribeContentCollection('cmsContent', 'published', onNext);
    capturedSuccess({
      docs: [
        { id: 'a', data: () => ({ title: 'A' }) },
        { id: 'b', data: () => ({ title: 'B' }) },
      ],
    });

    expect(onNext).toHaveBeenCalledWith([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ]);
  });

  it('fails soft: a listener error does not throw and leaves onNext uncalled', () => {
    let capturedError;
    onSnapshotMock.mockImplementation((_target, _onSuccess, onError) => {
      capturedError = onError;
      return vi.fn();
    });

    const onNext = vi.fn();
    subscribeContentCollection('cmsContent', 'published', onNext);
    expect(() => capturedError(new Error('permission denied'))).not.toThrow();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('returns the unsubscribe function from onSnapshot', () => {
    const detach = vi.fn();
    onSnapshotMock.mockImplementation(() => detach);

    const unsubscribe = subscribeContentCollection('cmsContent', 'published', vi.fn());
    expect(unsubscribe).toBe(detach);
  });
});
