import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onSnapshotMock = vi.fn();
const docMock = vi.fn((...args) => ({ __kind: 'doc', args }));

vi.mock('firebase/firestore', () => ({
  doc: (...args) => docMock(...args),
  onSnapshot: (...args) => onSnapshotMock(...args),
}));
vi.mock('../firebase.js', () => ({ db: {} }));

const { subscribeAnnouncements } = await import('./announcementsSource.js');

describe('subscribeAnnouncements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onSnapshotMock.mockReset();
    docMock.mockClear();
    onSnapshotMock.mockImplementation(() => vi.fn());
  });

  afterEach(() => vi.useRealTimers());

  it('listens to the public projection document', () => {
    subscribeAnnouncements(vi.fn());
    expect(docMock).toHaveBeenCalledWith({}, 'announcements_public', 'current');
  });

  it('passes through the rows stored on that document', () => {
    let onSuccess;
    onSnapshotMock.mockImplementation((_target, success) => {
      onSuccess = success;
      return vi.fn();
    });
    const onNext = vi.fn();
    subscribeAnnouncements(onNext);

    onSuccess({
      exists: () => true,
      data: () => ({ announcements: [{ id: 'active', message: 'Now' }] }),
    });

    expect(onNext).toHaveBeenCalledWith([{ id: 'active', message: 'Now' }]);
  });

  it('passes an empty list when the projection document is missing', () => {
    let onSuccess;
    onSnapshotMock.mockImplementation((_target, success) => {
      onSuccess = success;
      return vi.fn();
    });
    const onNext = vi.fn();
    subscribeAnnouncements(onNext);

    onSuccess({ exists: () => false });

    expect(onNext).toHaveBeenCalledWith([]);
  });
});
