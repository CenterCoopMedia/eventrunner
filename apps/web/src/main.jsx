import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
// Theme tokens first (the @generated alias honors GENERATED_DIR, spec §2.4),
// then the Tailwind layers that consume them.
import '@generated/theme.css';
import './index.css';
import { initErrorReporting } from './lib/errorReporting.js';

// Client-error telemetry (spec §9, issue #10): on in production builds by
// default, off in dev/emulator unless VITE_ENABLE_CLIENT_ERROR_REPORTING=true.
initErrorReporting();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
