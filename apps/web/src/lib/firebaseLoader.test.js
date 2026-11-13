import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChunkReload } from './chunkReload.js';

vi.unmock('./firebaseLoader.js');
vi.unmock('./firebaseSettings.js');

let frames;
let imported;

beforeEach(() => {
  vi.resetModules();
  frames = [];
  imported = 0;
  history.replaceState(null, '', '/');
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.push(callback); return frames.length; });
  vi.doMock('../firebase.js', () => {
    imported += 1;
    return { auth: {}, db: {}, appCheckHeaders: async () => ({ 'X-Firebase-AppCheck': 'test-attestation' }) };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

function paint() { frames.shift()(0); frames.shift()(16); }

describe('Firebase startup', () => {
  it('starts after a painted frame without advancing a timer and shares one load', async () => {
    const { firebaseReady, loadFirebase } = await import('./firebaseLoader.js');
    const ready = firebaseReady();
    expect(imported).toBe(0);
    frames.shift()(0);
    expect(imported).toBe(0);
    frames.shift()(16);
    await ready;
    expect(imported).toBe(1);
    expect(loadFirebase()).toBe(loadFirebase());
  });

  it.each(['/admin', '/profile', '/dashboard', '/tickets/mine', '/signin'])('loads immediately on %s', async (path) => {
    history.replaceState(null, '', path);
    const { firebaseReady } = await import('./firebaseLoader.js');
    await firebaseReady();
    expect(frames).toHaveLength(0);
    expect(imported).toBe(1);
  });

  it('uses a non-authoritative signed-in hint and clears it on sign-out', async () => {
    const { firebaseReady, rememberSignedIn } = await import('./firebaseLoader.js');
    rememberSignedIn(true);
    await firebaseReady();
    expect(frames).toHaveLength(0);
    rememberSignedIn(false);
    expect(localStorage.getItem('eventrunner:signed-in')).toBeNull();
  });

  it('takes the after-paint path when storage is refused', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('refused'); });
    const { firebaseReady } = await import('./firebaseLoader.js');
    const ready = firebaseReady();
    expect(frames).toHaveLength(1);
    paint();
    await ready;
  });

  it('does not attach an obsolete subscription after the SDK arrives', async () => {
    const { subscribeToFirebase, firebaseReady } = await import('./firebaseLoader.js');
    const attach = vi.fn();
    const stop = subscribeToFirebase(attach);
    stop();
    paint();
    await firebaseReady();
    expect(attach).not.toHaveBeenCalled();
  });

  it('attaches once and detaches the live listener on cleanup', async () => {
    const { subscribeToFirebase, firebaseReady } = await import('./firebaseLoader.js');
    const detach = vi.fn();
    const attach = vi.fn(() => detach);
    const stop = subscribeToFirebase(attach);
    paint();
    await firebaseReady();
    expect(attach).toHaveBeenCalledTimes(1);
    stop();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it('reports an SDK failure without reloading a snapshot reader', async () => {
    const error = new Error('Failed to fetch dynamically imported module');
    vi.doMock('../firebase.js', () => { throw error; });
    const { firebaseReady, isFirebaseLoading, subscribeToFirebase } = await import('./firebaseLoader.js');
    const reload = vi.fn();
    const remove = installChunkReload(window, { reload, isPrefetching: isFirebaseLoading });
    const onError = vi.fn();
    const attach = vi.fn();
    subscribeToFirebase(attach, onError);
    paint();
    await Promise.resolve();
    expect(isFirebaseLoading()).toBe(true);
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    const failure = await firebaseReady().catch((error) => error);
    expect(failure.cause || failure).toBe(error);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(attach).not.toHaveBeenCalled();
    expect(isFirebaseLoading()).toBe(false);
    remove();
  });

  it('waits for the configured attestation before returning protected request headers', async () => {
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', 'public-site-key');
    const { appCheckHeaders } = await import('./firebaseLoader.js');
    await expect(appCheckHeaders()).resolves.toEqual({ 'X-Firebase-AppCheck': 'test-attestation' });
    expect(imported).toBe(1);
  });

  it('needs no SDK when App Check is not configured', async () => {
    const { appCheckHeaders } = await import('./firebaseLoader.js');
    await expect(appCheckHeaders()).resolves.toEqual({});
    expect(imported).toBe(0);
  });

  it('keeps the unattested fallback when the configured SDK cannot load', async () => {
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', 'public-site-key');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.doMock('../firebase.js', () => { throw new Error('SDK unavailable'); });
    const { appCheckHeaders } = await import('./firebaseLoader.js');
    await expect(appCheckHeaders()).resolves.toEqual({});
    expect(warn).toHaveBeenCalled();
  });
});
