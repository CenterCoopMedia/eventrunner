import { lazy } from 'react';
import { clearReloadFlag, isChunkLoadError } from './chunkReload.js';

let speculativeLoads = 0;

export function isRoutePrefetchPending() {
  return speculativeLoads > 0;
}

function chunkError(message, chunkName, cause) {
  return Object.assign(new Error(message, { cause }), { name: 'ChunkLoadError', chunkName });
}

function rethrowImportFailure(chunkName) {
  return (error) => {
    // Safari can report a failed module script without its URL.
    if (chunkName && isChunkLoadError(error)) throw chunkError(error.message, chunkName, error);
    throw error;
  };
}

function requirePageModule(module, chunkName) {
  if (module?.default == null) {
    throw chunkError('The page module did not load.', chunkName);
  }
  return module;
}

// A loaded lazy Admin leaf re-arms the budget. AdminApp re-arms static leaves
// after their successful render commits and the shell's startup code succeeds.
export function lazyPage(importer, chunkName) {
  return lazy(() => importer().then((module) => {
    const page = requirePageModule(module, chunkName);
    clearReloadFlag();
    return page;
  }, rethrowImportFailure(chunkName)));
}

// Navigation and intent share one import. Only navigation clears the reload
// budget; an Admin container leaves that to its leaf page. A fulfilled
// thenable lets React use warmed code synchronously.
export function routePage(importer, { clearReloadOnLoad = true, chunkName } = {}) {
  let loaded;
  let pending;
  let speculation;
  function load() {
    // Prefetch also serves named-export helpers; only rendering needs default.
    return pending ||= importer().then((module) => (loaded = module), rethrowImportFailure(chunkName));
  }
  const Component = lazy(() => {
    if (loaded) {
      const page = requirePageModule(loaded, chunkName);
      return { then(resolve) { if (clearReloadOnLoad) clearReloadFlag(); resolve(page); } };
    }
    return load().then((module) => {
      const page = requirePageModule(module, chunkName);
      if (clearReloadOnLoad) clearReloadFlag();
      return page;
    });
  });
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
