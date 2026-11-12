export const HOVER_DWELL_MS = 100;

export function installRoutePrefetch(root, prefetchPath, { hashRouter = false } = {}) {
  let timer;
  function prefetch(link) {
    const connection = navigator.connection;
    if (connection?.saveData || /2g/.test(connection?.effectiveType)) return;
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    if (link.origin !== location.origin) return;
    if (hashRouter && (link.pathname !== location.pathname || !link.hash.startsWith('#/'))) return;
    prefetchPath(hashRouter ? link.hash.slice(1) : link.pathname);
  }
  function onIntent(event) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (event.type === 'pointerover' || event.type === 'pointerout') {
      if (event.pointerType !== 'mouse' || link?.contains(event.relatedTarget)) return;
      clearTimeout(timer);
      if (event.type === 'pointerover' && link) timer = setTimeout(() => { prefetch(link); }, HOVER_DWELL_MS);
    } else if (event.type === 'focusin' || event.pointerType === 'touch' || event.pointerType === 'pen') {
      prefetch(link);
    }
  }
  const events = ['pointerover', 'pointerout', 'focusin', 'pointerdown'];
  for (const name of events) root.addEventListener(name, onIntent);
  return () => {
    clearTimeout(timer);
    for (const name of events) root.removeEventListener(name, onIntent);
  };
}
