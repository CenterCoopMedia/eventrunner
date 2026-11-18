import React from 'react';
import { BrowserRouter, HashRouter, useLocation } from 'react-router';
import { IS_DEMO } from './lib/demoMode.js';
import { eventAppPath, eventMount } from './lib/eventPath.js';

// A trailing-slash basename would refuse a bare mount before routes render.
export function canonicalizeEventHome() {
  if (IS_DEMO) return;
  const { pathname, search, hash } = window.location;
  const mount = eventMount();
  if (mount && pathname === mount) {
    window.history.replaceState(window.history.state, '', `${import.meta.env.BASE_URL}${search}${hash}`);
  }
}

function MountedEvent({ children }) {
  useLocation();
  // React Router matches basenames case-insensitively. Event mounts are exact.
  return eventAppPath(window.location.pathname) === null ? null : children;
}

export default function EventRouter({ children }) {
  // Pages has no route rewrites. Its asset base must stay out of the hash.
  if (IS_DEMO) return <HashRouter>{children}</HashRouter>;
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <MountedEvent>{children}</MountedEvent>
    </BrowserRouter>
  );
}
