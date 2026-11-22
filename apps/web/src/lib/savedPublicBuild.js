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

export function confirmPublicRead(dataset) {
  if (readSavedPublicBuild()) confirmations.set(dataset, Date.now());
}

export function hasStalePublicReads(datasets, now = Date.now()) {
  return datasets.some((dataset) => {
    const time = confirmations.get(dataset);
    return !Number.isFinite(time) || time > now || now - time >= 300_000;
  });
}
