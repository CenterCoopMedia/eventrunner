import { lazy } from 'react';
import { clearReloadFlag } from './chunkReload.js';

let speculativeLoads = 0;

export function isRoutePrefetchPending() {
  return speculativeLoads > 0;
}

// Navigation and intent share one import. Only navigation clears the reload
// budget. A fulfilled thenable lets React use warmed code synchronously.
export function routePage(importer) {
  let loaded;
  let pending;
  let speculation;
  function load() {
    return pending ||= importer().then((module) => (loaded = module));
  }
  const Component = lazy(() => loaded ? {
    then(resolve) { clearReloadFlag(); resolve(loaded); },
  } : load().then((module) => { clearReloadFlag(); return module; }));
  function prefetch() {
    if (loaded || speculation) return speculation;
    speculativeLoads += 1;
    speculation = load().then(
      (module) => { speculativeLoads -= 1; return module; },
      () => { speculativeLoads -= 1; pending = null; },
    );
    return speculation;
  }
  return { Component, prefetch };
}
