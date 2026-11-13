import { useEffect } from 'react';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

export default function AppRoot() {
  // Static content keeps the entry's existing recovery control until React
  // commits. This also clears it when the root boundary shows an error.
  useEffect(() => { document.getElementById('app-boot')?.remove(); }, []);
  return <ErrorBoundary title="The site could not be shown"><App /></ErrorBoundary>;
}
