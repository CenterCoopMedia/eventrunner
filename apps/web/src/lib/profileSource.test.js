import { beforeEach, describe, expect, it, vi } from 'vitest';

// profileSource's seams to Firestore are onSnapshot/getDocFromServer/updateDoc over
// doc()/query() refs — mock the SDK so tests can inspect the query shape the
// directory asks for (the visibility filter is load-bearing under the rules)
// and drive listener callbacks directly.
const onSnapshotMock = vi.fn();
const getDocMock = vi.fn();
const updateDocMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ collection: name }),
  doc: (_db, name, id) => ({ path: `${name}/${id}` }),
  getDocFromServer: (...args) => getDocMock(...args),
  limit: (n) => ({ limit: n }),
  onSnapshot: (...args) => onSnapshotMock(...args),
  query: (target, ...constraints) => ({ ...target, constraints }),
  serverTimestamp: () => ({ sentinel: 'serverTimestamp' }),
  updateDoc: (...args) => updateDocMock(...args),
  where: (field, op, value) => ({ field, op, value }),
}));
vi.mock('../firebase.js', () => ({ db: {} }));

const {
  fetchPublicProfile,
  saveOwnProfile,
  subscribeDirectory,
  subscribeOwnProfile,
} = await import('./profileSource.js');

beforeEach(() => {
  onSnapshotMock.mockReset();
  getDocMock.mockReset();
  updateDocMock.mockReset();
  updateDocMock.mockResolvedValue(undefined);
});

describe('subscribeOwnProfile', () => {
  it('reports the account document when it exists', () => {
    let onSuccess;
    onSnapshotMock.mockImplementation((_ref, next) => {
      onSuccess = next;
      return vi.fn();
    });
    const onNext = vi.fn();
    subscribeOwnProfile('u1', onNext);
    onSuccess({ exists: () => true, id: 'u1', data: () => ({ displayName: 'Rae' }) });
    expect(onNext).toHaveBeenCalledWith({ id: 'u1', displayName: 'Rae' });
  });

  it('reports null while the account document has not been seeded yet', () => {
    let onSuccess;
    onSnapshotMock.mockImplementation((_ref, next) => {
      onSuccess = next;
      return vi.fn();
    });
    const onNext = vi.fn();
    subscribeOwnProfile('u1', onNext);
    onSuccess({ exists: () => false });
    expect(onNext).toHaveBeenCalledWith(null);
  });
});

describe('saveOwnProfile', () => {
  it('rejects oversized fields without issuing a Firestore write', () => {
    for (const fields of [{ bio: 'a'.repeat(2001) }, { socialHandles: { site: 'a'.repeat(513) } }]) {
      expect(() => saveOwnProfile('u1', fields)).toThrow();
    }
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('sends only the self-editable fields', async () => {
    await saveOwnProfile('u1', {
      displayName: 'Rae',
      bio: 'Reporter',
      profileVisibility: 'public',
      badges: ['writer'],
      // Server-owned: the rules reject a write that touches any of these.
      registrationStatus: 'approved',
      speakerId: 'spk-1',
      approvalSource: 'admin',
      role: 'admin',
      email: 'someone@example.org',
      profileComplete: true,
    });
    const [, payload] = updateDocMock.mock.calls[0];
    expect(payload).toEqual({
      displayName: 'Rae',
      bio: 'Reporter',
      profileVisibility: 'public',
      badges: ['writer'],
      // Stamped here, from the server clock — this is updatedAt's only
      // writer, so a profile edit never leaves the creation time in place.
      updatedAt: { sentinel: 'serverTimestamp' },
    });
  });

  it('omits fields the caller did not supply rather than blanking them', async () => {
    await saveOwnProfile('u1', { displayName: 'Rae' });
    const [, payload] = updateDocMock.mock.calls[0];
    expect(payload).toEqual({
      displayName: 'Rae',
      updatedAt: { sentinel: 'serverTimestamp' },
    });
  });
});

describe('subscribeDirectory', () => {
  it('asks only for public profiles when the viewer has no attendee access', () => {
    onSnapshotMock.mockImplementation(() => vi.fn());
    subscribeDirectory({ includeAttendeesOnly: false }, vi.fn());
    const [target] = onSnapshotMock.mock.calls[0];
    expect(target.collection).toBe('users_public');
    expect(target.constraints).toEqual([
      { field: 'profileVisibility', op: '==', value: 'public' },
    ]);
  });

  it('includes attendees_only profiles for a viewer who has attendee access', () => {
    onSnapshotMock.mockImplementation(() => vi.fn());
    subscribeDirectory({ includeAttendeesOnly: true }, vi.fn());
    const [target] = onSnapshotMock.mock.calls[0];
    expect(target.constraints).toEqual([
      { field: 'profileVisibility', op: 'in', value: ['public', 'attendees_only'] },
    ]);
  });

  it('reports listener failures so the page can say the directory is unavailable', () => {
    let onError;
    onSnapshotMock.mockImplementation((_target, ...rest) => {
      onError = rest.at(-1);
      return vi.fn();
    });
    const onFail = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    subscribeDirectory({ includeAttendeesOnly: true }, vi.fn(), onFail);
    onError(new Error('permission denied'));
    expect(onFail).toHaveBeenCalled();
  });

  it('shows public profiles while the rules refuse the full directory, then restores it (issue 1004)', () => {
    vi.useFakeTimers();
    try {
      const listeners = [];
      onSnapshotMock.mockImplementation((target, ...rest) => {
        const options = typeof rest[0] === 'function' ? null : rest.shift();
        const [next, errorCb] = rest;
        listeners.push({ target, options, next, errorCb });
        return vi.fn();
      });
      const onFail = vi.fn();
      const onNext = vi.fn();
      const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
      const stop = subscribeDirectory({ includeAttendeesOnly: true }, onNext, onFail);
      const privateRows = [{ id: 'u1', data: () => ({ profileVisibility: 'attendees_only' }) }];
      const publicRows = [{ id: 'u2', data: () => ({ profileVisibility: 'public' }) }];
      listeners[0].next({ docs: privateRows });
      expect(onNext).toHaveBeenLastCalledWith([{ id: 'u1', profileVisibility: 'attendees_only' }]);

      listeners[0].errorCb(denied);
      expect(onNext).toHaveBeenLastCalledWith(null);
      listeners[0].next({ docs: privateRows });
      listeners[0].errorCb(denied);
      expect(onNext).toHaveBeenCalledTimes(2);
      // The public listener and a one-row probe of the full directory.
      expect(listeners[1].target.constraints).toEqual([
        { field: 'profileVisibility', op: '==', value: 'public' },
      ]);
      expect(listeners[2].target.constraints).toEqual([
        { field: 'profileVisibility', op: 'in', value: ['public', 'attendees_only'] },
        { limit: 1 },
      ]);
      expect(onFail).not.toHaveBeenCalled();
      listeners[1].next({ docs: publicRows });
      expect(onNext).toHaveBeenLastCalledWith([{ id: 'u2', profileVisibility: 'public' }]);

      listeners[2].errorCb(denied);
      vi.runOnlyPendingTimers();
      listeners[2].next({ docs: [] });
      expect(listeners).toHaveLength(4);
      listeners[3].next({ docs: [] });
      expect(listeners[4].target.constraints).toEqual([
        { field: 'profileVisibility', op: 'in', value: ['public', 'attendees_only'] },
      ]);
      listeners[4].next({ docs: privateRows });
      expect(onNext).toHaveBeenLastCalledWith([{ id: 'u1', profileVisibility: 'attendees_only' }]);
      expect(onFail).not.toHaveBeenCalled();
      stop();
      listeners[4].next({ docs: privateRows });
      listeners[4].errorCb(denied);
      expect(onNext).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the server before showing the full directory', () => {
    const listeners = [];
    onSnapshotMock.mockImplementation((target, ...rest) => {
      const options = typeof rest[0] === 'function' ? null : rest.shift();
      listeners.push({ target, options, next: rest[0] });
      return vi.fn();
    });
    const onNext = vi.fn();
    subscribeDirectory({ includeAttendeesOnly: true }, onNext);
    expect(listeners[0].options).toEqual({ includeMetadataChanges: true });
    const rows = [{ id: 'u1', data: () => ({ profileVisibility: 'attendees_only' }) }];
    // Rows cached for an earlier account in this tab.
    listeners[0].next({ docs: rows, metadata: { fromCache: true } });
    expect(onNext).not.toHaveBeenCalled();
    listeners[0].next({ docs: rows, metadata: { fromCache: false } });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('keeps the public directory while the probe has only cached rows', () => {
    const listeners = [];
    onSnapshotMock.mockImplementation((target, ...rest) => {
      const options = typeof rest[0] === 'function' ? null : rest.shift();
      listeners.push({ target, options, next: rest[0], errorCb: rest[1] });
      return vi.fn();
    });
    subscribeDirectory({ includeAttendeesOnly: true }, vi.fn());
    listeners[0].errorCb(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    expect(listeners[2].options).toEqual({ includeMetadataChanges: true });
    // Public rows from the narrow listener match the probe in the cache.
    listeners[2].next({ docs: [], metadata: { fromCache: true } });
    expect(listeners).toHaveLength(3);
  });

  it('reports a refused public directory as unavailable', () => {
    let onError;
    onSnapshotMock.mockImplementation((_target, _next, errorCb) => {
      onError = errorCb;
      return vi.fn();
    });
    const onFail = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    subscribeDirectory({ includeAttendeesOnly: false }, vi.fn(), onFail);
    onError(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    expect(onFail).toHaveBeenCalled();
  });
});

describe('fetchPublicProfile', () => {
  it('reads the profile from the server, never from the cache (issue 1004)', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    await fetchPublicProfile('u1');
    expect(getDocMock).toHaveBeenCalledWith({ path: 'users_public/u1' });
  });

  it('returns the projection when it is readable', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      id: 'u1',
      data: () => ({ displayName: 'Rae' }),
    });
    await expect(fetchPublicProfile('u1')).resolves.toEqual({ id: 'u1', displayName: 'Rae' });
  });

  it('returns null for a denied read, exactly as for a missing profile', async () => {
    getDocMock.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'permission-denied' }));
    await expect(fetchPublicProfile('u1')).resolves.toBeNull();

    getDocMock.mockResolvedValue({ exists: () => false });
    await expect(fetchPublicProfile('u2')).resolves.toBeNull();
  });

  it('distinguishes a transient read failure from a refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = Object.assign(new Error('offline'), { code: 'unavailable' });
    getDocMock.mockRejectedValue(error);
    await expect(fetchPublicProfile('u1')).rejects.toBe(error);
  });
});
