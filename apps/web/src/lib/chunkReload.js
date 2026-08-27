// Recovery for a stale entry bundle asking for a chunk that no longer exists.
//
// The admin CMS is code-split out of the visitor bundle (issue #95,
// App.jsx). A tab that has been open across a deploy — or a browser holding a
// cached entry bundle — asks Hosting for an admin chunk filename the new build
// no longer publishes. The dynamic import rejects, and nothing in the app
// catches that on its own: the admin route just fails to render.
//
// One reload fetches the current entry bundle and the correct chunk names with
// it, which fixes every ordinary case. It has to be exactly one: if the reload
// does not help (offline, a genuinely broken deploy), reloading again would
// loop forever, so the attempt is recorded in sessionStorage and the second
// failure is left for ChunkErrorBoundary to show as a retry panel instead.

export const RELOAD_FLAG = 'eventrunner:chunk-reload';

const CHUNK_ERROR_RE =
  /(dynamically imported module|importing a module script failed|loading chunk|failed to fetch dynamically)/i;

/**
 * Is this the browser's "I could not fetch that module" failure?
 *
 * The message differs per engine (Chrome, Firefox, and Safari each word it
 * their own way), so this matches on the shared fragments rather than one
 * exact string.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  return CHUNK_ERROR_RE.test(String(error.message || error));
}

/**
 * Whether a recovery reload has already been tried in this tab.
 *
 * A storage access that throws (Safari private browsing, blocked site data)
 * reads as "already tried": without somewhere to record the attempt, reloading
 * could not be limited to one, and a reload loop is worse than a retry panel.
 *
 * @param {Storage|null} storage
 * @returns {boolean}
 */
export function hasReloaded(storage = safeStorage()) {
  if (!storage) return true;
  try {
    return storage.getItem(RELOAD_FLAG) === '1';
  } catch {
    return true;
  }
}

function safeStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Reload once to pick up the current bundle.
 *
 * @param {{ storage?: Storage|null, reload?: () => void }} [options]
 * @returns {boolean} true when a reload was started
 */
export function reloadOnce({ storage = safeStorage(), reload } = {}) {
  if (hasReloaded(storage)) return false;
  try {
    storage.setItem(RELOAD_FLAG, '1');
  } catch {
    return false;
  }
  (reload || (() => globalThis.location.reload()))();
  return true;
}

/**
 * Clear the flag once a chunk has loaded, so a later deploy gets its own
 * single reload rather than inheriting a spent one.
 *
 * @param {Storage|null} storage
 */
export function clearReloadFlag(storage = safeStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(RELOAD_FLAG);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/**
 * Listen for Vite's `vite:preloadError`, which fires when a modulepreload for
 * a lazy chunk fails. Calling `preventDefault()` stops Vite rethrowing, so it
 * is only correct when a reload is actually starting; otherwise the error is
 * left to propagate to ChunkErrorBoundary.
 *
 * @param {EventTarget} [target]
 * @param {{ reload?: () => void }} [options]
 * @returns {() => void} removes the listener
 */
export function installChunkReload(target = globalThis, { reload } = {}) {
  const onPreloadError = (event) => {
    if (reloadOnce({ reload })) event.preventDefault();
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
