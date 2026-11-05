import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppRoutes } from '../../../console/web/src/App.jsx';
import { AuthContext } from '../../../console/web/src/auth.jsx';
import '../../../console/web/src/styles.css';
import { auth } from './firebase.js';

// Production routes and styles, with test-only identity and intercepted HTTP.
// The production build has no entry point or flag for this fixture.
const context = { user: auth.currentUser, ready: true, signOut: async () => {} };
createRoot(globalThis.document.getElementById('root')).render(
  createElement(AuthContext.Provider, { value: context },
    createElement(BrowserRouter, null, createElement(AppRoutes))),
);
