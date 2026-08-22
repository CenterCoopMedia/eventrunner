import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onSnapshotMock = vi.fn();
const collectionMock = vi.fn((_db, path) => ({ __kind: 'collection', path }));

vi.mock('firebase/firestore', () => ({
  collection: (...args) => collectionMock(...args),
  onSnapshot: (...args) => onSnapshotMock(...args),
}));
vi.mock('../firebase.js', () => ({ db: {} }));
vi.mock('../contexts/AuthContext.jsx', () => ({
  functionsOrigin: () => 'https://fake-functions.example',
}));

const {
  MaterialRequestError,
  subscribeSessionMaterials,
  fetchSessionMaterialUrl,
  downloadSessionMaterialFile,
} = await import('./materialsSource.js');

function docRow(id, sessionId, overrides = {}) {
  return { id, sessionId, type: 'link', filename: id, reviewStatus: 'approved', ...overrides };
}

describe('subscribeSessionMaterials (shared collection-wide listener)', () => {
  let detach;
  // The module keeps its shared-listener state (ref count, grouping) at
  // module scope by design — that IS the fix under test — so every test
  // must unsubscribe everything it attached, or the next test would see a
  // false "already attached" state left over from this one. sub() tracks
  // every subscription so afterEach can tear them all down uniformly.
  let activeUnsubs;

  function sub(sessionId, onNext, onError) {
    const unsubscribe = subscribeSessionMaterials(sessionId, onNext, onError);
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

  it('calls onNext with an empty array and subscribes to nothing when sessionId is falsy', () => {
    const onNext = vi.fn();
    const unsubscribe = subscribeSessionMaterials(undefined, onNext);
    expect(onNext).toHaveBeenCalledWith([]);
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('attaches exactly ONE onSnapshot listener no matter how many sessions subscribe', () => {
    sub('s1', vi.fn());
    sub('s2', vi.fn());
    sub('s3', vi.fn());
    expect(onSnapshotMock).toHaveBeenCalledTimes(1);
    expect(collectionMock).toHaveBeenCalledWith({}, 'session_materials_public');
  });

  it('two subscribers to the SAME session (a pill and a detail list) share the one listener', () => {
    const onNextA = vi.fn();
    const onNextB = vi.fn();
    sub('s1', onNextA);
    sub('s1', onNextB);
    expect(onSnapshotMock).toHaveBeenCalledTimes(1);

    const [, onSuccess] = onSnapshotMock.mock.calls[0];
    onSuccess({ docs: [{ id: 'm1', data: () => docRow('m1', 's1') }] });

    expect(onNextA).toHaveBeenCalledWith([docRow('m1', 's1')]);
    expect(onNextB).toHaveBeenCalledWith([docRow('m1', 's1')]);
  });

  it('groups one collection-wide snapshot by sessionId and fans out only the matching rows', () => {
    const onNextS1 = vi.fn();
    const onNextS2 = vi.fn();
    sub('s1', onNextS1);
    sub('s2', onNextS2);

    const [, onSuccess] = onSnapshotMock.mock.calls[0];
    onSuccess({
      docs: [
        { id: 'm1', data: () => docRow('m1', 's1') },
        { id: 'm2', data: () => docRow('m2', 's2') },
        { id: 'm3', data: () => docRow('m3', 's1') },
      ],
    });

    expect(onNextS1).toHaveBeenCalledWith([docRow('m1', 's1'), docRow('m3', 's1')]);
    expect(onNextS2).toHaveBeenCalledWith([docRow('m2', 's2')]);
  });

  it('detaches the shared listener only once every subscriber has unsubscribed', () => {
    const unsubA = subscribeSessionMaterials('s1', vi.fn());
    const unsubB = subscribeSessionMaterials('s2', vi.fn());
    expect(onSnapshotMock).toHaveBeenCalledTimes(1);

    unsubA();
    expect(detach).not.toHaveBeenCalled();

    unsubB();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it('re-attaches a fresh shared listener after every subscriber left and a new one arrives', () => {
    const unsub = subscribeSessionMaterials('s1', vi.fn());
    unsub();
    sub('s2', vi.fn());
    expect(onSnapshotMock).toHaveBeenCalledTimes(2);
  });

  it('a late subscriber immediately gets the already-known grouping for its session', () => {
    sub('s1', vi.fn());
    const [, onSuccess] = onSnapshotMock.mock.calls[0];
    onSuccess({ docs: [{ id: 'm1', data: () => docRow('m1', 's1') }] });

    const onNextLate = vi.fn();
    sub('s1', onNextLate);
    expect(onNextLate).toHaveBeenCalledWith([docRow('m1', 's1')]);
  });

  it('fails soft on a listener error: every subscriber is notified via onError, onNext is untouched', () => {
    sub('s1', vi.fn());
    const onNext = vi.fn();
    const onError = vi.fn();
    sub('s2', onNext, onError);

    const [, , onListenerError] = onSnapshotMock.mock.calls[0];
    const err = new Error('permission denied');
    onListenerError(err);

    expect(onError).toHaveBeenCalledWith(err);
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('fetchSessionMaterialUrl', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('omits Authorization when there is no signed-in user (anonymous post-embargo access)', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ type: 'link', filename: 'Deck', url: 'https://example.org/deck' }),
    });
    await fetchSessionMaterialUrl({ user: null, materialId: 'm1' });
    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('throws a MaterialRequestError with the server error on a non-2xx response', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'forbidden', message: 'This material is not available yet.' } }),
    });
    const err = await fetchSessionMaterialUrl({ user: null, materialId: 'm1' }).catch((e) => e);
    expect(err).toBeInstanceOf(MaterialRequestError);
    expect(err).toMatchObject({ code: 'forbidden', status: 403 });
  });
});

describe('downloadSessionMaterialFile', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  function fakeUser(token = 'id-token') {
    return { getIdToken: vi.fn(async () => token) };
  }

  it('POSTs to downloadSessionMaterial with a bearer token and triggers a local download', async () => {
    const blob = new Blob(['bytes']);
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, blob: async () => blob });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadSessionMaterialFile({ user: fakeUser(), materialId: 'm1', filename: 'slides.pdf' });

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://fake-functions.example/downloadSessionMaterial');
    expect(opts.headers.Authorization).toBe('Bearer id-token');
    expect(JSON.parse(opts.body)).toEqual({ materialId: 'm1' });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
  });

  it('throws MaterialRequestError on a non-2xx response without touching the DOM', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'forbidden', message: 'This material is not available yet.' } }),
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(
      downloadSessionMaterialFile({ user: fakeUser(), materialId: 'm1', filename: 'slides.pdf' }),
    ).rejects.toMatchObject({ name: 'MaterialRequestError', code: 'forbidden' });
    expect(clickSpy).not.toHaveBeenCalled();

    clickSpy.mockRestore();
  });
});
