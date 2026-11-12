import { routePage } from './routePage.jsx';

const intentCode = routePage(() => import('./routePrefetch.js'));

// Only intent handling is deferred; direct navigation uses the entry route table.
export function installDeferredRoutePrefetch(root, routes, hashRouter) {
  let active = true;
  let code;
  function onIntent(event) {
    const connection = navigator.connection;
    if (connection?.saveData || /2g/.test(connection?.effectiveType)) return;
    if (!event.target.closest?.('a[href]')) return;
    intentCode.prefetch().then((module) => {
      code = module;
      if (active) code?.handleRouteIntent(event, routes, hashRouter);
    });
  }
  const events = ['pointerover', 'pointerout', 'focusin', 'pointerdown'];
  for (const name of events) root.addEventListener(name, onIntent);
  return () => {
    active = false;
    code?.cancelRoutePrefetch();
    for (const name of events) root.removeEventListener(name, onIntent);
  };
}
