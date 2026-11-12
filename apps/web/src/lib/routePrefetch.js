import { matchRoutes } from 'react-router';

export const HOVER_DWELL_MS = 100;
let timer;

export function cancelRoutePrefetch() { clearTimeout(timer); }

function prefetch(link, routes, hashRouter) {
  const connection = navigator.connection;
  if (connection?.saveData || /2g/.test(connection?.effectiveType)) return;
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  if (link.origin !== location.origin) return;
  if (hashRouter && (link.pathname !== location.pathname || !link.hash.startsWith('#/'))) return;
  const path = hashRouter ? link.hash.slice(1) : link.pathname;
  matchRoutes(routes, path)?.at(-1)?.route.prefetch?.();
}

export function handleRouteIntent(event, routes, hashRouter = false) {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (event.type === 'pointerover' || event.type === 'pointerout') {
    if (event.pointerType !== 'mouse' || link?.contains(event.relatedTarget)) return;
    clearTimeout(timer);
    if (event.type === 'pointerover' && link) timer = setTimeout(() => { prefetch(link, routes, hashRouter); }, HOVER_DWELL_MS);
  } else if (event.type === 'focusin' || event.pointerType === 'touch' || event.pointerType === 'pen') {
    prefetch(link, routes, hashRouter);
  }
}

export function installRoutePrefetch(root, routes, hashRouter) {
  const onIntent = (event) => handleRouteIntent(event, routes, hashRouter);
  const events = ['pointerover', 'pointerout', 'focusin', 'pointerdown'];
  for (const name of events) root.addEventListener(name, onIntent);
  return () => {
    cancelRoutePrefetch();
    for (const name of events) root.removeEventListener(name, onIntent);
  };
}
