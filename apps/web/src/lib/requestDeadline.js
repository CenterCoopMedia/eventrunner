export const REQUEST_DEADLINE_MS = 20_000;

/** Bound a send even if token lookup, transport or response reading stalls. */
export async function requestWithDeadline(request, unconfirmed, signal) {
  if (signal?.aborted) return unconfirmed;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let stopped = false;
  let stop;
  const deadline = new Promise((resolve) => {
    stop = () => {
      stopped = true;
      resolve(unconfirmed);
      controller?.abort();
    };
  });
  const timeout = setTimeout(stop, REQUEST_DEADLINE_MS);
  signal?.addEventListener('abort', stop, { once: true });

  try {
    return await Promise.race([request(controller?.signal ?? signal, () => stopped), deadline]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
  }
}
