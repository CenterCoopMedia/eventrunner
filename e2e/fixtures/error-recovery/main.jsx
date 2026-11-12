// Hosted fixture: the production boundary and reporter, without Firebase
// providers. Every HTTP report is intercepted by the browser test.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation } from 'react-router';
import ErrorBoundary from '../../../apps/web/src/components/ErrorBoundary.jsx';
import { initErrorReporting } from '../../../apps/web/src/lib/errorReporting.js';
import '../../../apps/web/src/generated/theme.css';
import '../../../apps/web/src/index.css';

initErrorReporting();

function Crash() {
  const { pathname } = useLocation();
  throw new Error(pathname === '/chunk-error'
    ? 'Failed to fetch dynamically imported module: /assets/missing-page.js'
    : 'Synthetic production render failure');
}

function Shell() {
  const { pathname } = useLocation();
  if (pathname === '/layout-error') throw new Error('Synthetic layout render failure');
  const admin = pathname.startsWith('/admin/');
  return (
    <>
      <header className="stage py-md">
        <nav aria-label={admin ? 'Admin sections' : 'Main'}>
          <Link to="/working">Working page</Link>
        </nav>
      </header>
      <main className="stage">
        <ErrorBoundary appearance={admin ? 'admin' : 'public'} title={admin ? 'This admin page could not be shown' : 'This page could not be shown'}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </>
  );
}

function Stepper() {
  const [answer, setAnswer] = useState('');
  return (
    <>
      <label>Answer<input value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>
      <Link to="/steps/second">Next step</Link>
    </>
  );
}

function FailedForm({ title }) {
  return (
    <>
      <h1>Page content</h1>
      <ErrorBoundary appearance="inline" title={title} description="Reload the page to try again.">
        <Crash />
      </ErrorBoundary>
    </>
  );
}

createRoot(globalThis.document.getElementById('root')).render(
  <BrowserRouter>
    <ErrorBoundary title="The site could not be shown" description="The site ran into a problem. Reload to try again.">
      <Routes>
        <Route element={<Shell />}>
          <Route path="/working" element={<h1>Working page content</h1>} />
          <Route path="/steps/:step" element={<Stepper />} />
          <Route path="/feedback-error" element={<FailedForm title="The feedback form could not open" />} />
          <Route path="/change-request-error" element={<FailedForm title="The change request form could not open" />} />
          <Route path="*" element={<Crash />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  </BrowserRouter>,
);
