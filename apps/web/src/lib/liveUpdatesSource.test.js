import { beforeEach, describe, expect, it, vi } from 'vitest';

// subscribeLiveUpdates runs TWO onSnapshot listeners — one for pinned rows
// (where pinned == true, uncapped-ish), one for the capped "recent" query —
// and merges them (Codex P2: a single orderBy+limit query can push an older
// PINNED row off the page once N newer unpinned rows land). Track calls in
// registration order so each test can address "the pinned listener" vs "the
// recent listener" by index.
const calls = [];
// A listener may pass snapshot options before its callbacks.
const onSnapshotMock = vi.fn((_target, ...rest) => {
  const options = typeof rest[0] === 'function' ? null : rest.shift();
  const [onSuccess, onError] = rest;
  calls.push({ options, onSuccess, onError });
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

const { readableAudiences, subscribeLiveUpdates } = await import('./liveUpdatesSource.js');

function doc(id, fields) {
  return { id, data: () => fields };
}

describe('subscribeLiveUpdates', () => {
  beforeEach(() => {
    calls.length = 0;
    whereMock.mockClear();
  });

  it('registers a pinned (where pinned == true) query and a capped recent query', () => {
    subscribeLiveUpdates(['everyone'], vi.fn());
    expect(whereMock).toHaveBeenCalledWith('pinned', '==', true);
    expect(calls.length).toBe(2);
  });

  it('does not drop an older pinned entry that falls outside the recent cap', () => {
    const onNext = vi.fn();
    subscribeLiveUpdates(['everyone'], onNext);
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
    subscribeLiveUpdates(['everyone'], onNext);
    const [pinned] = calls;
    pinned.onSuccess({ docs: [] });
    expect(onNext).not.toHaveBeenCalled();
  });

  it('de-duplicates a row present in both queries and sorts newest first', () => {
    const onNext = vi.fn();
    subscribeLiveUpdates(['everyone'], onNext);
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

  it('carries the audience predicate on both queries (issue 200)', () => {
    queryMock.mockClear();
    subscribeLiveUpdates(['everyone', 'attendees'], vi.fn());
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const [, ...constraints] of queryMock.mock.calls) {
      expect(constraints).toContainEqual({ __kind: 'where', field: 'audience', op: 'in', value: ['everyone', 'attendees'] });
    }
  });

  it('shows everyone rows while the rules refuse attendee rows, then restores them (issue 1005)', () => {
    vi.useFakeTimers();
    try {
      queryMock.mockClear();
      const onNext = vi.fn();
      subscribeLiveUpdates(['everyone', 'attendees'], onNext);
      const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
      calls[0].onError(denied);
      calls[1].onError(denied);
      // The everyone listeners and one probe of the wider list replace the refused pair.
      expect(calls.length).toBe(5);
      const audiences = queryMock.mock.calls.map(([, ...constraints]) =>
        constraints.find((c) => c.field === 'audience').value);
      expect(audiences).toEqual([
        ['everyone', 'attendees'], ['everyone', 'attendees'], ['everyone'], ['everyone'], ['everyone', 'attendees'],
      ]);
      calls[2].onSuccess({ docs: [doc('e1', { audience: 'everyone', postedAt: new Date(1000) })] });
      calls[3].onSuccess({ docs: [] });
      expect(onNext.mock.calls.at(-1)[0].map((d) => d.id)).toEqual(['e1']);

      // A refused probe tries again after the retry delay.
      calls[4].onError(denied);
      vi.runOnlyPendingTimers();
      expect(calls.length).toBe(6);
      // Once the wider list is allowed (a sweep ended), the full pair returns.
      calls[5].onSuccess({ docs: [] });
      expect(calls.length).toBe(8);
      calls[6].onSuccess({ docs: [] });
      calls[7].onSuccess({ docs: [doc('a1', { audience: 'attendees', postedAt: new Date(2000) })] });
      expect(onNext.mock.calls.at(-1)[0].map((d) => d.id)).toEqual(['a1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the server before showing attendee rows', () => {
    const onNext = vi.fn();
    subscribeLiveUpdates(['everyone', 'attendees'], onNext);
    expect(calls[0].options).toEqual({ includeMetadataChanges: true });
    const cached = { docs: [doc('a1', { audience: 'attendees', postedAt: new Date(2000) })], metadata: { fromCache: true } };
    calls[0].onSuccess(cached);
    calls[1].onSuccess(cached);
    expect(onNext).not.toHaveBeenCalled();
    calls[0].onSuccess({ ...cached, metadata: { fromCache: false } });
    calls[1].onSuccess({ ...cached, metadata: { fromCache: false } });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('keeps everyone rows while the probe has only cached rows', () => {
    subscribeLiveUpdates(['everyone', 'attendees'], vi.fn());
    const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    calls[0].onError(denied);
    calls[4].onSuccess({ docs: [], metadata: { fromCache: true } });
    expect(calls.length).toBe(5);
  });

  it('keeps the speaker audience list after a refusal', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    subscribeLiveUpdates(['everyone', 'attendees', 'speakers'], vi.fn());
    calls[0].onError(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    expect(calls.length).toBe(2);
  });
});

// The same three answers firestore.rules readableLiveUpdateAudiences()
// gives; tests/firestore.rules.test.js proves the rules side.
describe('readableAudiences', () => {
  it('gives a signed-out reader everyone only', () => {
    expect(readableAudiences({ signedIn: false })).toEqual(['everyone']);
    expect(readableAudiences({ signedIn: false, profile: { speakerId: 'spk-1' }, isAdmin: true })).toEqual(['everyone']);
  });

  it('gives a signed-in account that is not approved everyone only', () => {
    expect(readableAudiences({ signedIn: true, profile: null })).toEqual(['everyone']);
    expect(readableAudiences({ signedIn: true, profile: { registrationStatus: 'pending', speakerId: null } })).toEqual(['everyone']);
    expect(readableAudiences({ signedIn: true, profile: { registrationStatus: 'ticketed' } })).toEqual(['everyone']);
  });

  it('adds attendees for an approved attendee, and not speakers', () => {
    expect(readableAudiences({ signedIn: true, profile: { registrationStatus: 'approved', speakerId: null } }))
      .toEqual(['everyone', 'attendees']);
  });

  it('gives a speaker or an admin all three', () => {
    expect(readableAudiences({ signedIn: true, profile: { registrationStatus: 'pending', speakerId: 'spk-1' } }))
      .toEqual(['everyone', 'attendees', 'speakers']);
    expect(readableAudiences({ signedIn: true, profile: null, isAdmin: true }))
      .toEqual(['everyone', 'attendees', 'speakers']);
  });
});
