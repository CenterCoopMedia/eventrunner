import { lazy, Suspense, useEffect, useState } from 'react';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { IS_DEMO } from './lib/demoMode.js';

const SavedPublicNotice = import.meta.env.PROD && !IS_DEMO
  ? lazy(() => import('./components/SavedPublicNotice.jsx').catch(() => ({ default: () => null })))
  : null;

export default function AppRoot({ children }) {
  const [offlineReady, setOfflineReady] = useState(false);
  useEffect(() => {
    if (!SavedPublicNotice || !navigator.serviceWorker) return undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setOfflineReady(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  // Static content keeps the entry's existing recovery control until React
  // commits. This also clears it when the root boundary shows an error.
  useEffect(() => { document.getElementById('app-boot')?.remove(); }, []);
  // Busy controls draw no figure for their first second, so the observer
  // loads after first paint and stays out of the entry bundle.
  useEffect(() => {
    let uninstall = () => {};
    let live = true;
    import('./lib/busyControlFigures.js').then(({ installBusyControlFigures }) => {
      if (live) uninstall = installBusyControlFigures();
    });
    return () => {
      live = false;
      uninstall();
    };
  }, []);
  return <ErrorBoundary title="The site could not be shown">
    {offlineReady && <Suspense fallback={null}><SavedPublicNotice /></Suspense>}
    {children ?? <App />}
  </ErrorBoundary>;
}
