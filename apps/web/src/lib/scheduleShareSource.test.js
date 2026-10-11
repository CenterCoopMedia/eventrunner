import { beforeEach, describe, expect, it, vi } from 'vitest';

// subscribeOwnScheduleShare's seam to Firestore is onSnapshot(doc(db, ...)).
// Drive the success callback directly. The display name below is the stored
// fixture, not a value captured from a run.
const onSnapshotMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ path: args.slice(1).join('/') }),
  onSnapshot: (...args) => onSnapshotMock(...args),
}));
vi.mock('../firebase.js', () => ({ db: { name: 'db' } }));
vi.mock('../contexts/AuthContext.jsx', () => ({
  functionsOrigin: () => 'http://localhost',
}));

const { subscribeOwnScheduleShare, subscribeScheduleShare } = await import('./scheduleShareSource.js');

function emit(data) {
  const onNext = vi.fn();
  onSnapshotMock.mockImplementation((_ref, onSuccess) => {
    onSuccess({
      exists: () => true,
      data: () => data,
    });
    return vi.fn();
  });
  subscribeOwnScheduleShare('owner-1', onNext);
  return onNext.mock.calls[0][0];
}

describe('subscribeOwnScheduleShare', () => {
  beforeEach(() => {
    onSnapshotMock.mockReset();
  });

  it('keeps a stored display name with the visibility and the session ids', () => {
    const share = emit({
      scheduleVisibility: 'public',
      sessionIds: ['s1'],
      displayName: 'Alex Rivera',
    });
    expect(share).toEqual({
      scheduleVisibility: 'public',
      sessionIds: ['s1'],
      displayName: 'Alex Rivera',
    });
  });

  it('uses the same reader for a shared schedule link', () => {
    expect(subscribeScheduleShare).toBe(subscribeOwnScheduleShare);
  });

  it('drops a blank or non-text display name', () => {
    expect(emit({ displayName: '   ', scheduleVisibility: 'public', sessionIds: [] }).displayName).toBeNull();
    expect(emit({ displayName: 42, scheduleVisibility: 'public', sessionIds: [] }).displayName).toBeNull();
    expect(emit({ scheduleVisibility: 'attendees_only', sessionIds: ['s2'] }).displayName).toBeNull();
  });

  it('answers null when the owner has no projection', () => {
    const onNext = vi.fn();
    onSnapshotMock.mockImplementation((_ref, onSuccess) => {
      onSuccess({ exists: () => false, data: () => undefined });
      return vi.fn();
    });
    subscribeOwnScheduleShare('owner-1', onNext);
    expect(onNext).toHaveBeenCalledWith(null);
  });

  it('answers null and does not listen when there is no uid', () => {
    const onNext = vi.fn();
    subscribeOwnScheduleShare('', onNext);
    expect(onNext).toHaveBeenCalledWith(null);
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });
});
