// Hosted fixture: the production boundary and reporter, without Firebase
// providers. Every HTTP report is intercepted by the browser test.
import { createElement as h, Fragment, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation } from 'react-router';
import ErrorBoundary from '../../src/components/ErrorBoundary.jsx';
import { initErrorReporting } from '../../src/lib/errorReporting.js';
import '../../src/generated/theme.css';
import '../../src/index.css';

initErrorReporting();
globalThis.document.documentElement.dataset.navigationType =
  globalThis.performance.getEntriesByType('navigation')[0].type;

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
  return h(Fragment, null,
    h('header', { className: 'stage py-md' },
      h('nav', { 'aria-label': admin ? 'Admin sections' : 'Main' },
        h(Link, { to: '/working' }, 'Working page'))),
    h('main', { className: 'stage' },
      h(ErrorBoundary, {
        appearance: admin ? 'admin' : 'public',
        title: admin ? 'This admin page could not be shown' : 'This page could not be shown',
      }, h(Outlet))));
}

function Stepper() {
  const [answer, setAnswer] = useState('');
  return h(Fragment, null,
    h('label', null, 'Answer', h('input', { value: answer, onChange: (event) => setAnswer(event.target.value) })),
    h(Link, { to: '/steps/second' }, 'Next step'));
}

function FailedForm({ title }) {
  return h(Fragment, null,
    h('h1', null, 'Page content'),
    h(ErrorBoundary, { appearance: 'inline', title }, h(Crash)));
}

createRoot(globalThis.document.getElementById('root')).render(
  h(BrowserRouter, null,
    h(ErrorBoundary, { title: 'The site could not be shown' },
      h(Routes, null,
        h(Route, { element: h(Shell) },
          h(Route, { path: '/working', element: h('h1', null, 'Working page content') }),
          h(Route, { path: '/steps/:step', element: h(Stepper) }),
          h(Route, { path: '/feedback-error', element: h(FailedForm, { title: 'The feedback form could not open' }) }),
          h(Route, { path: '/change-request-error', element: h(FailedForm, { title: 'The change request form could not open' }) }),
          h(Route, { path: '*', element: h(Crash) }))))),
);
