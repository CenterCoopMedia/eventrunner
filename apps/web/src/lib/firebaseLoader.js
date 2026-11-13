import { startTransition } from 'react';
import { appCheckEnabled } from './firebaseSettings.js';

const SIGNED_IN_HINT = 'eventrunner:signed-in';
let runtime;
let startup;
let loading = false;

export function rememberSignedIn(signedIn) {
  try {
    if (signedIn) localStorage.setItem(SIGNED_IN_HINT, '1');
    else localStorage.removeItem(SIGNED_IN_HINT);
  } catch { /* A hint never controls authorization. */ }
}

function needsAuthNow() {
  const path = location.hash.startsWith('#/') ? location.hash.slice(1) : location.pathname;
  if (/^\/(?:admin|profile|dashboard|tickets\/mine|signin)(?:\/|$)/.test(path)) return true;
  try { return localStorage.getItem(SIGNED_IN_HINT) === '1'; } catch { return false; }
}

export function isFirebaseLoading() { return loading; }

/** One runtime and one SDK instance across concurrent providers and actions. */
export function loadFirebase() {
  if (!runtime) {
    loading = true;
    globalThis.performance?.mark?.('eventrunner:firebase-start');
    runtime = import('../firebase.js')
      .catch((error) => { runtime = null; throw error; })
      .finally(() => { loading = false; });
  }
  return runtime;
}

/** The next frame after a painted frame; no timer or idle delay. */
function afterPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export function firebaseReady() {
  if (!startup) startup = (needsAuthNow() ? loadFirebase() : afterPaint().then(loadFirebase))
    .catch((error) => { startup = null; throw error; });
  return startup;
}

/** Keep the synchronous unsubscribe contract while the SDK loads. */
export function subscribeToFirebase(attach, onError = (error) => console.warn('Live updates could not start.', error)) {
  let stopped = false;
  let detach;
  firebaseReady().then((sdk) => {
    if (!stopped) detach = attach(sdk);
  }).catch((error) => {
    // An unavailable background runtime must not replace a still-hydrating
    // snapshot. The callback still runs now; React can finish hydration
    // before committing its error/status state.
    if (!stopped) startTransition(() => onError(error));
  });
  return () => { stopped = true; detach?.(); };
}

export async function appCheckHeaders() {
  if (!appCheckEnabled) return {};
  try {
    return await (await loadFirebase()).appCheckHeaders();
  } catch (error) {
    console.warn('App Check unavailable; sending the request unattested.', error);
    return {};
  }
}
