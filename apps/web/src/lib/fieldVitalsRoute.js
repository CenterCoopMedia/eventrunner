import { matchRoutes } from 'react-router';
import { prefetchRoutes } from '../routes.jsx';
import { eventAppPath } from './eventPath.js';

// Match the rendering registry, then return its pattern, never its parameters.
export function fieldVitalsRoute(input) {
  try {
    const url = new URL(input, globalThis.location?.origin || 'https://event.invalid');
    // React Router warns with the raw path on malformed escapes. Keep it out
    // of console/error telemetry as well as the performance payload.
    decodeURIComponent(url.pathname);
    const path = eventAppPath(url.pathname);
    const route = path && matchRoutes(prefetchRoutes, path)?.at(-1)?.route.path;
    if (!route || route === '*' || route === 'specimen') return '/*';
    return route.startsWith('/') ? route : `/${route}`;
  } catch {
    return '/*';
  }
}
