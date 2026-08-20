import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// subscribeConfigDoc's one seam to Firestore is onSnapshot(doc(db, ...)) —
// mock the SDK so tests drive success/error callbacks directly instead of
// hitting a real listener (matches the seam contract documented in
// configSource.js).
const onSnapshotMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (...args) => ({ path: args.slice(1).join('/') }),
  onSnapshot: (...args) => onSnapshotMock(...args),
}));
vi.mock('../firebase.js', () => ({ db: {} }));

const { subscribeConfigDoc } = await import('./configSource.js');

describe('subscribeConfigDoc', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onSnapshotMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onNext with the doc data when a snapshot exists', () => {
    let capturedSuccess;
    const detach = vi.fn();
    onSnapshotMock.mockImplementation((_ref, onSuccess) => {
      capturedSuccess = onSuccess;
      return detach;
    });

    const onNext = vi.fn();
    subscribeConfigDoc('theme', onNext);
    capturedSuccess({ exists: () => true, data: () => ({ radius: 'round' }) });

    expect(onNext).toHaveBeenCalledWith({ radius: 'round' });
  });

  it('ignores a snapshot for a missing doc', () => {
    let capturedSuccess;
    onSnapshotMock.mockImplementation((_ref, onSuccess) => {
      capturedSuccess = onSuccess;
      return vi.fn();
    });

    const onNext = vi.fn();
    subscribeConfigDoc('theme', onNext);
    capturedSuccess({ exists: () => false });

    expect(onNext).not.toHaveBeenCalled();
  });

  it('re-attaches a fresh listener after a delay when the listener errors', () => {
    let capturedError;
    let attachCount = 0;
    onSnapshotMock.mockImplementation((_ref, _onSuccess, onError) => {
      attachCount += 1;
      capturedError = onError;
      return vi.fn();
    });

    subscribeConfigDoc('theme', vi.fn());
    expect(attachCount).toBe(1);

    capturedError(new Error('stream error'));
    expect(attachCount).toBe(1); // not yet retried

    vi.runOnlyPendingTimers();
    expect(attachCount).toBe(2); // re-attached after the retry delay
  });

  it('cancels a pending retry and detaches the live listener on unsubscribe', () => {
    let attachCount = 0;
    const detach = vi.fn();
    let capturedError;
    onSnapshotMock.mockImplementation((_ref, _onSuccess, onError) => {
      attachCount += 1;
      capturedError = onError;
      return detach;
    });

    const unsubscribe = subscribeConfigDoc('theme', vi.fn());
    capturedError(new Error('stream error'));
    unsubscribe();

    vi.runOnlyPendingTimers();
    expect(attachCount).toBe(1); // retry was cancelled, no re-attach
    expect(detach).toHaveBeenCalledTimes(1);
  });
});
