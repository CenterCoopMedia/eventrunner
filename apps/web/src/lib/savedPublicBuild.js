export function readSavedPublicBuild() {
  const marker = globalThis.document?.querySelector('meta[name="eventrunner-saved-build"]');
  if (!marker) return null;
  const [id, savedAt, generatedAt] = marker.content.split('|');
  return { id, savedAt, generatedAt };
}

export const LIVE_RELOAD_PARAM = 'eventrunner-live';

export function reloadPublicPageFromNetwork() {
  const url = new URL(globalThis.location.href);
  url.searchParams.set(LIVE_RELOAD_PARAM, '1');
  globalThis.location.replace(url);
}

const confirmations = new Map();

export function recordPublicRead(dataset, status) {
  if (!readSavedPublicBuild()) return;
  if (status === 'server') confirmations.set(dataset, { at: Date.now(), current: true });
  else if (status === 'cache') confirmations.delete(dataset);
  else if (status === 'interrupted' && confirmations.has(dataset)) {
    confirmations.set(dataset, { ...confirmations.get(dataset), current: false });
  }
}

export function hasStalePublicReads(datasets, now = Date.now()) {
  return datasets.some((dataset) => {
    const { at, current } = confirmations.get(dataset) ?? {};
    // A server-backed listener remains current until it reports a cached
    // result or loses its subscription. Age applies to a last-known read.
    return !Number.isFinite(at) || at > now || (!current && now - at >= 300_000);
  });
}
