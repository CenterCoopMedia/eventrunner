import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { IS_DEMO } from './lib/demoMode.js';
// Theme tokens first (the @generated alias honors GENERATED_DIR, spec §2.4),
// then the Tailwind layers that consume them.
import '@generated/theme.css';
import './index.css';
import { initErrorReporting } from './lib/errorReporting.js';
import { installChunkReload } from './lib/chunkReload.js';

// Client-error telemetry (spec §9, issue #10): on in production builds by
// default, off in dev/emulator unless VITE_ENABLE_CLIENT_ERROR_REPORTING=true.
initErrorReporting();

// A stale entry bundle can ask for a lazy chunk (the admin CMS, App.jsx) that
// the current deploy no longer publishes. Vite reports the failed
// modulepreload as `vite:preloadError`; one reload per tab picks up the
// current bundle. The flag that limits it to one is cleared where the chunk
// actually loads (App.jsx), not here — clearing it on every entry load would
// re-arm the reload on the very page the reload landed on, and loop.
installChunkReload();

// Real deployments are served by Firebase Hosting, which rewrites every path
// to index.html, so the app uses real URLs (BrowserRouter). The static demo
// build (VITE_DEMO_MODE=1) is served by GitHub Pages, which has no rewrite
// rules at all: a reload of /eventrunner/demo/schedule would 404. HashRouter
// keeps every route inside the fragment, so deep links and reloads work with
// zero server config. The alternative — basename + a 404.html SPA shim —
// cannot be scoped to this build: Pages only serves the SITE-root 404.html,
// which here is the project's docs/ site, so the shim would hijack 404
// handling for every unrelated docs page too.
const Router = IS_DEMO ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </Router>
  </React.StrictMode>,
);
