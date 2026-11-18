import { afterEach, expect, it, vi } from 'vitest';

const uid = 'same-test-account';
const doc = 'pages/about';

async function event(project, base) {
  vi.resetModules();
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', project);
  vi.stubEnv('BASE_URL', base);
  const [state, requests, drafts, pitches, recovery] = await Promise.all([
    import('./eventBrowserState.js'), import('./changeRequestMarker.js'), import('./localDraft.js'),
    import('./pitchDraft.js'), import('./chunkReload.js'),
  ]);
  return { ...state, ...requests, ...drafts, ...pitches, ...recovery };
}

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('isolates browser state and sign-out for the same account on one host', async () => {
  const first = await event('conference-first', '/conference/');
  const second = await event('conference-second', '/events/second/');
  const firstDraft = first.openLocalDraft(uid, doc, 'v1');
  const secondDraft = second.openLocalDraft(uid, doc, 'v1');

  first.markChangeRequestSent(uid);
  first.savePitch({ title: 'First event pitch' });
  first.reloadOnce({ reload: vi.fn() });
  expect(firstDraft.write('first draft', 'baseline')).toBe(true);
  expect(first.hasSentChangeRequest(uid)).toBe(true);
  expect(second.hasSentChangeRequest(uid)).toBe(false);
  expect(first.restorePitch().title).toBe('First event pitch');
  expect(second.restorePitch().title).toBe('');
  expect(first.hasReloaded()).toBe(true);
  expect(second.hasReloaded()).toBe(false);
  expect(secondDraft.read()).toBeNull();

  expect(secondDraft.write('second draft', 'baseline')).toBe(true);
  const firstSignal = vi.fn();
  const secondSignal = vi.fn();
  window.addEventListener(first.LOCAL_DRAFTS_CLEARED, firstSignal, { once: true });
  window.addEventListener(second.LOCAL_DRAFTS_CLEARED, secondSignal, { once: true });
  try {
    first.clearLocalDrafts(uid);
    expect(firstDraft.revoked()).toBe(true);
    expect(firstDraft.read()).toBeNull();
    expect(secondDraft.revoked()).toBe(false);
    expect(secondDraft.read()?.value).toBe('second draft');
    expect(firstSignal).toHaveBeenCalledOnce();
    expect(secondSignal).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(first.LOCAL_DRAFTS_CLEARED, firstSignal);
    window.removeEventListener(second.LOCAL_DRAFTS_CLEARED, secondSignal);
  }
});

it('keeps root keys readable without exposing old root state to mounted events', async () => {
  localStorage.setItem(`changeRequests.sent.${uid}`, '1');
  sessionStorage.setItem('session-pitch-draft-v1', JSON.stringify({ title: 'Existing pitch' }));

  const mounted = await event('conference-first', '/conference/');
  expect(mounted.hasSentChangeRequest(uid)).toBe(false);
  expect(mounted.restorePitch().title).toBe('');

  const root = await event('conference-root', '/');
  expect(root.mountedProjectId).toBeNull();
  expect(root.hasSentChangeRequest(uid)).toBe(true);
  expect(root.restorePitch().title).toBe('Existing pitch');
});
