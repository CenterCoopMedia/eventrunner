import records from './src/clientHostRecords.cjs';
import routeMap from './src/clientHostMap.cjs';
import routing from './src/clientHostRouter.cjs';
import publicHost from './src/clientHostPublic.cjs';

const { reservedClientPath } = records;
const { createRouteMapReader, validateRouteMap } = routeMap;
const { createClientHostRouter } = routing;
const { createPublicHostHandler } = publicHost;

export function createClientHostWorker({ bucket, fetchMap, fetchUpstream, hostFallback, log }) {
  const loadHost = async (hostname) => {
    const readMap = createRouteMapReader({ bucket, fetchMap });
    const map = await readMap(hostname);
    return map ? validateRouteMap(map, hostname) : null;
  };
  const handleHostRequest = createPublicHostHandler({
    fallback: (request, url) => reservedClientPath(url.pathname) ? hostFallback?.fetch(request) : null,
    fetchUpstream,
    log,
  });
  return createClientHostRouter({ loadHost, handleHostRequest, fetchUpstream, log });
}

export default {
  fetch(request, env) {
    const route = createClientHostWorker({
      bucket: env.CLIENT_ROUTE_MAP_BUCKET,
      hostFallback: env.CLIENT_HOST_FALLBACK,
    });
    // The host's raw-path ingress rule must run before Workers URL normalization.
    return route(request, request.url);
  },
};
