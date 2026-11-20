import { useEffect } from 'react';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { installBusyControlFigures } from './lib/heldFigures.js';

export default function AppRoot({ children }) {
  // Static content keeps the entry's existing recovery control until React
  // commits. This also clears it when the root boundary shows an error.
  useEffect(() => { document.getElementById('app-boot')?.remove(); }, []);
  useEffect(() => installBusyControlFigures(), []);
  return <ErrorBoundary title="The site could not be shown">{children ?? <App />}</ErrorBoundary>;
}
