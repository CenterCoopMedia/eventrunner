import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collection, onSnapshot } from 'firebase/firestore';
import { RETRY_DELAY_MS } from '../lib/retrySubscription.js';

vi.unmock('./pendingCountsSource.js');
const { subscribePendingCounts } = await import('./pendingCountsSource.js');
const ALL = ['cmsContent', 'cmsPages', 'cmsSchedule', 'cmsOrganizations', 'cmsUpdates', 'cmsTimeline'];
const counts = (changes = {}) => ({
  schemaVersion: 1,
  counts: Object.fromEntries(ALL.map((id) => [id, changes[id] ?? 0])),
});
const snapshot = (data) => ({ exists: () => data !== null, data: () => data });
const detach = vi.fn();
const last = () => {
  const [ref, next, error] = vi.mocked(onSnapshot).mock.calls.at(-1);
  return { ref, next, error };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(onSnapshot).mockClear().mockImplementation(() => detach);
  vi.mocked(collection).mockClear();
  detach.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe('the one-document count subscription', () => {
  it('reads cmsMeta/pending and no collection, delivering only known counts', () => {
    const initialize = vi.fn();
    const onNext = vi.fn();
    const stop = subscribePendingCounts(initialize, onNext);
    expect(last().ref.path).toEqual(['cmsMeta', 'pending']);
    const data = counts({ cmsPages: 2001 });
    data.counts.unrelated = 999;
    last().next(snapshot(data));
    expect(onNext).toHaveBeenCalledWith(counts({ cmsPages: 2001 }).counts);
    expect(initialize).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalled();
    stop();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { schemaVersion: 1, counts: { cmsPages: 4 } },
    counts({ cmsPages: -1 }),
    counts({ cmsPages: 0.5 }),
    counts({ cmsPages: Number.MAX_SAFE_INTEGER + 1 }),
    { ...counts(), schemaVersion: 0 },
  ])('bootstraps missing or invalid data once without inventing a zero: %j', async (data) => {
    const initialize = vi.fn(async () => ({ ok: true }));
    const onNext = vi.fn();
    const stop = subscribePendingCounts(initialize, onNext);
    last().next(snapshot(data));
    last().next(snapshot(data));
    await vi.advanceTimersByTimeAsync(0);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
    last().next(snapshot(counts({ cmsContent: 3 })));
    expect(onNext).toHaveBeenCalledWith(counts({ cmsContent: 3 }).counts);
    stop();
  });

  it('detaches before retrying a failed bootstrap and ignores the old stream', async () => {
    const failure = new Error('bootstrap unavailable');
    const initialize = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue({ ok: true });
    const onNext = vi.fn();
    const onError = vi.fn();
    const stop = subscribePendingCounts(initialize, onNext, onError);
    const first = last();
    first.next(snapshot(null));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(detach).toHaveBeenCalledTimes(1);
    first.next(snapshot(counts({ cmsPages: 999 })));
    expect(onNext).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    last().next(snapshot(null));
    await vi.advanceTimersByTimeAsync(0);
    expect(initialize).toHaveBeenCalledTimes(2);
    last().next(snapshot(counts({ cmsPages: 1 })));
    expect(onNext).toHaveBeenCalledWith(counts({ cmsPages: 1 }).counts);
    stop();
  });

  it('can initialize again if a restored count document later disappears', async () => {
    const initialize = vi.fn(async () => ({ ok: true }));
    const onNext = vi.fn();
    const stop = subscribePendingCounts(initialize, onNext);
    last().next(snapshot(null));
    await vi.advanceTimersByTimeAsync(0);
    last().next(snapshot(counts({ cmsPages: 2 })));
    last().next(snapshot(null));
    await vi.advanceTimersByTimeAsync(0);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(onNext).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reattaches after a Firestore failure and cancels retries on unmount', async () => {
    const onError = vi.fn();
    const stop = subscribePendingCounts(vi.fn(), vi.fn(), onError);
    const failure = new Error('denied');
    last().error(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    last().error(failure);
    stop();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not initialize or deliver after cleanup, including a late rejection', async () => {
    let reject;
    const initialize = vi.fn(() => new Promise((_resolve, fail) => { reject = fail; }));
    const onNext = vi.fn();
    const onError = vi.fn();
    const stop = subscribePendingCounts(initialize, onNext, onError);
    const first = last();
    first.next(snapshot(null));
    await vi.advanceTimersByTimeAsync(0);
    stop();
    reject(new Error('late'));
    first.next(snapshot(counts({ cmsPages: 999 })));
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(onNext).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });
});
