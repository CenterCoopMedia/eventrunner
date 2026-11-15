// Shared retry wrapper for Firestore onSnapshot listeners (spec §2.4).
//
// Per the Firestore SDK contract, once a listener's error callback fires the
// listener is terminated for good — it will not recover on its own. A public
// doc or collection rarely errors, but a tab left open all day (e.g. an
// attendee's schedule page) that hits one transient stream error would
// otherwise stop receiving updates for the rest of the session with no
// indication and no retry. This wraps any onSnapshot-shaped subscribe call so
// a listener error re-attaches a fresh listener after a delay instead of
// staying silently dead. Callers keep rendering their last-known values in
// the gap — onNext simply isn't called again until the retry succeeds.
export const RETRY_DELAY_MS = 15_000;

/**
 * @param {(onError: (error: unknown) => void) => (() => void)} attach
 *   Attaches one listener, wiring its error path to the given onError
 *   callback, and returns that listener's detach function.
 * @param {(error: unknown) => void} [onErrorLogged]
 *   Called with each error before scheduling the retry (e.g. to log it).
 * @param {number} [retryDelayMs]
 * @returns {() => void} Unsubscribe — detaches the live listener and cancels
 *   any pending retry.
 */
export function subscribeWithRetry(
  attach,
  onErrorLogged,
  retryDelayMs = RETRY_DELAY_MS,
) {
  let detachCurrent = null;
  let retryTimer = null;
  let stopped = false;

  function attachOnce() {
    detachCurrent = attach((error) => {
      onErrorLogged?.(error);
      if (stopped) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!stopped) attachOnce();
      }, retryDelayMs);
    });
  }

  attachOnce();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (typeof detachCurrent === 'function') detachCurrent();
  };
}

/**
 * Listen with the wider query until the rules refuse it, then listen with
 * the narrower one, which the rules always allow, and probe the wider query
 * after each retry delay. The first probe snapshot restores the wider
 * listener. Used where a server-private ticket grant decides the wider
 * query (issues 1004 and 1005), so a sweep that ends or a repaired grant
 * restores the rows without a reload.
 *
 * @param {{ wide: (onRefused: () => void) => (() => void),
 *           narrow: () => (() => void),
 *           probe: (onAllowed: (snapshot: object) => void, onError: (error: unknown) => void) => (() => void),
 *           retryDelayMs?: number }} listeners
 *   `wide` calls onRefused when the rules refuse it; `probe` attaches one
 *   small listener for the wider query with metadata changes included, so
 *   the server confirmation arrives even when the rows match the cache.
 * @returns {() => void} Unsubscribe
 */
export function subscribeWithFallback({ wide, narrow, probe, retryDelayMs = RETRY_DELAY_MS }) {
  // Cached rows that the narrow listener holds also match the wider query,
  // so only a server-confirmed probe snapshot proves the rules allow it.
  let detach = attachWide();

  function attachWide() {
    let refused = false;
    return wide(() => {
      if (refused) return;
      refused = true;
      detach();
      detach = attachNarrow();
    });
  }

  function attachNarrow() {
    let restored = false;
    const detachNarrow = narrow();
    const detachProbe = subscribeWithRetry(
      (onError) => probe((snapshot) => {
        if (restored || snapshot?.metadata?.fromCache) return;
        restored = true;
        detach();
        detach = attachWide();
      }, onError),
      undefined,
      retryDelayMs,
    );
    return () => {
      detachProbe();
      detachNarrow();
    };
  }

  return () => detach();
}

/**
 * A snapshot guard for a listener whose rows depend on a
 * server-private grant: rows cached for an earlier account must not show
 * before the server confirms this one, so cached snapshots wait for the
 * first server-confirmed snapshot of each attach.
 *
 * @param {(snapshot: object) => void} onNext
 * @returns {(snapshot: object) => void}
 */
export function afterServerConfirms(onNext) {
  let confirmed = false;
  return (snapshot) => {
    if (!confirmed && snapshot?.metadata?.fromCache) return;
    confirmed = true;
    onNext(snapshot);
  };
}

/** onSnapshot options for afterServerConfirms and the fallback probe. */
export const SERVER_CONFIRMATION = Object.freeze({ includeMetadataChanges: true });
