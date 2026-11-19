import { createClientHostWorker } from '../../console/functions/client-host-worker.mjs';

const rehearsalHost = 'er1063-rehearsal.eventrunner.org';
const eventOrigin = 'https://er-rehearsal-nov4.web.app';

export function faultUpstream(fetchImpl = fetch) {
  return (input, options) => {
    const url = new URL(input);
    if (url.origin === eventOrigin && !url.search) {
      if (url.pathname === '/rehearsal-origin-unavailable') return new Response(null, { status: 503 });
      if (url.pathname === '/rehearsal-origin-loop') {
        return new Response(null, { status: 302, headers: { location: url.href } });
      }
    }
    return fetchImpl(input, options);
  };
}

export default {
  fetch(request, env) {
    if (new URL(request.url).hostname !== rehearsalHost) return new Response(null, { status: 404 });
    const route = createClientHostWorker({ bucket: env.CLIENT_ROUTE_MAP_BUCKET, fetchUpstream: faultUpstream() });
    return route(request, request.url);
  },
};
