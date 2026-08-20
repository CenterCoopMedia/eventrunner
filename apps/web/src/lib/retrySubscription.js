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
