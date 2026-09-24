// The History section's renderer, loaded on demand (issue #194).
//
// The past editions list, its component and the committed snapshot of the
// entries are their own chunk, because the chunk every visitor downloads
// has almost no room left under its ceiling (scripts/ci/bundle-budget.json).
// Until the chunk arrives the home page draws the History section the way it
// always has, through the page's default section drawing: the operator's
// own blocks under the section's heading, on first paint. When it arrives
// the section is drawn again with the editions under those blocks. A load
// that fails leaves the default drawing in place, and it is forgotten, so
// the next home page to ask tries again (the lib/presetRemaps.js rule).
import { useEffect, useState } from 'react';

let loaded = null;
let loading = null;

function loadHistorySection() {
  if (!loading) {
    loading = import('./HistorySection.jsx').then(
      (module) => {
        loaded = module.default;
        return loaded;
      },
      (error) => {
        loading = null;
        throw error;
      },
    );
  }
  return loading;
}

/**
 * The HistorySection component once its chunk has loaded, else null.
 *
 * @param {boolean} wanted whether the page has a History section to draw;
 *   a page without one never fetches the chunk
 * @returns {import('react').ComponentType|null}
 */
export function useHistorySection(wanted) {
  const [component, setComponent] = useState(() => loaded);
  useEffect(() => {
    if (!wanted || component) return undefined;
    let current = true;
    loadHistorySection().then(
      (next) => {
        if (current) setComponent(() => next);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [wanted, component]);
  return component;
}
