import { createElement, lazy, useEffect } from 'react';
import { clearReloadFlag } from './chunkReload.js';

let speculativeLoads = 0;

export function isRoutePrefetchPending() {
  return speculativeLoads > 0;
}

// Navigation and intent share one import. Only mounting the page clears the
// reload budget; downloading it while reading another page must not do so.
export function routePage(importer, { resetReloadBudget = true } = {}) {
  let loaded;
  let pending;
  let speculation;
  function load() {
    if (!pending) {
      pending = importer().then((module) => (loaded = module)).catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  }
  const LazyPage = lazy(load);
  function Page(props) {
    useEffect(() => { if (resetReloadBudget) clearReloadFlag(); }, []);
    // A completed prefetch renders synchronously, without a loading fallback.
    return createElement(loaded?.default || LazyPage, props);
  }
  function prefetch() {
    if (loaded) return Promise.resolve(loaded);
    if (speculation) return speculation;
    speculativeLoads += 1;
    speculation = load().catch(() => {}).finally(() => { speculativeLoads -= 1; });
    return speculation;
  }
  return { Component: Page, prefetch };
}
