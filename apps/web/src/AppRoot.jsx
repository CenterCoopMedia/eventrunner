import { useEffect } from 'react';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

export default function AppRoot({ children }) {
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
  return <ErrorBoundary title="The site could not be shown">{children ?? <App />}</ErrorBoundary>;
}
