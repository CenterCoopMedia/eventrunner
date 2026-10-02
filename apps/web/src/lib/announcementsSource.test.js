import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { subscribeAnnouncements } = await import('./announcementsSource.js');

describe('subscribeAnnouncements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T14:00:00.000Z'));
    onSnapshotMock.mockReset();
    collectionMock.mockClear();
    whereMock.mockClear();
    queryMock.mockClear();
    onSnapshotMock.mockImplementation(() => vi.fn());
  });

  afterEach(() => vi.useRealTimers());

  it('excludes ended history with a timestamp-compatible query', () => {
    subscribeAnnouncements(vi.fn());

    expect(collectionMock).toHaveBeenCalledWith({}, 'announcements');
    expect(whereMock).toHaveBeenCalledWith(
      'endsAt',
      '>',
      new Date('2026-10-02T14:00:00.000Z'),
    );
    expect(queryMock).toHaveBeenCalledWith(
      { __kind: 'collection', name: 'announcements' },
      {
        __kind: 'where',
        field: 'endsAt',
        op: '>',
        value: new Date('2026-10-02T14:00:00.000Z'),
      },
    );
  });

  it('returns every matching active and future row without a client cap', () => {
    let onSuccess;
    onSnapshotMock.mockImplementation((_target, success) => {
      onSuccess = success;
      return vi.fn();
    });
    const onNext = vi.fn();
    subscribeAnnouncements(onNext);

    onSuccess({
      docs: [
        { id: 'active', data: () => ({ message: 'Now' }) },
        { id: 'future-1', data: () => ({ message: 'Later' }) },
        { id: 'future-2', data: () => ({ message: 'Much later' }) },
      ],
    });

    expect(onNext).toHaveBeenCalledWith([
      { id: 'active', message: 'Now' },
      { id: 'future-1', message: 'Later' },
      { id: 'future-2', message: 'Much later' },
    ]);
  });
});
