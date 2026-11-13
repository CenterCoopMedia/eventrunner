import { lazy } from 'react';
import { clearReloadFlag } from './chunkReload.js';

let speculativeLoads = 0;

export function isRoutePrefetchPending() {
  return speculativeLoads > 0;
}

function requirePageModule(module) {
  if (module?.default == null) {
    const error = new Error('The page module did not load.');
    error.name = 'ChunkLoadError';
    throw error;
  }
  return module;
}

export function lazyPage(importer) {
  return lazy(() => importer().then((module) => {
    const page = requirePageModule(module);
    clearReloadFlag();
    return page;
  }));
}

// Navigation and intent share one import. Only navigation clears the reload
// budget; an Admin container leaves that to its leaf page. A fulfilled
// thenable lets React use warmed code synchronously.
export function routePage(importer, { clearReloadOnLoad = true } = {}) {
  let loaded;
  let pending;
  let speculation;
  function load() {
    return pending ||= importer().then((module) => (loaded = requirePageModule(module)));
  }
  const Component = lazy(() => loaded ? {
    then(resolve) { if (clearReloadOnLoad) clearReloadFlag(); resolve(loaded); },
  } : load().then((module) => { if (clearReloadOnLoad) clearReloadFlag(); return module; }));
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
