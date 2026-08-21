import { beforeEach, describe, expect, it, vi } from 'vitest';

// profileSource's seams to Firestore are onSnapshot/getDoc/updateDoc over
// doc()/query() refs — mock the SDK so tests can inspect the query shape the
// directory asks for (the visibility filter is load-bearing under the rules)
// and drive listener callbacks directly.
const onSnapshotMock = vi.fn();
const getDocMock = vi.fn();
const updateDocMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ collection: name }),
  doc: (_db, name, id) => ({ path: `${name}/${id}` }),
  getDoc: (...args) => getDocMock(...args),
  onSnapshot: (...args) => onSnapshotMock(...args),
  query: (target, ...constraints) => ({ ...target, constraints }),
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
    });
  });

  it('omits fields the caller did not supply rather than blanking them', async () => {
    await saveOwnProfile('u1', { displayName: 'Rae' });
    const [, payload] = updateDocMock.mock.calls[0];
    expect(payload).toEqual({ displayName: 'Rae' });
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
    onSnapshotMock.mockImplementation((_target, _next, errorCb) => {
      onError = errorCb;
      return vi.fn();
    });
    const onFail = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    subscribeDirectory({ includeAttendeesOnly: true }, vi.fn(), onFail);
    onError(new Error('permission denied'));
    expect(onFail).toHaveBeenCalled();
  });
});

describe('fetchPublicProfile', () => {
  it('returns the projection when it is readable', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      id: 'u1',
      data: () => ({ displayName: 'Rae' }),
    });
    await expect(fetchPublicProfile('u1')).resolves.toEqual({ id: 'u1', displayName: 'Rae' });
  });

  it('returns null for a denied read, exactly as for a missing profile', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getDocMock.mockRejectedValue(new Error('permission denied'));
    await expect(fetchPublicProfile('u1')).resolves.toBeNull();

    getDocMock.mockResolvedValue({ exists: () => false });
    await expect(fetchPublicProfile('u2')).resolves.toBeNull();
  });
});
