import { matchRoutes } from 'react-router';
import { prefetchRoutes } from '../routes.jsx';

// Match the rendering registry, then return its pattern, never its parameters.
export function fieldVitalsRoute(input) {
  try {
    const url = new URL(input, globalThis.location?.origin || 'https://event.invalid');
    // React Router warns with the raw path on malformed escapes. Keep it out
    // of console/error telemetry as well as the performance payload.
    decodeURIComponent(url.pathname);
    const route = matchRoutes(prefetchRoutes, url.pathname)?.at(-1)?.route.path;
    if (!route || route === '*' || route === 'specimen') return '/*';
    return route.startsWith('/') ? route : `/${route}`;
  } catch {
    return '/*';
  }
}
