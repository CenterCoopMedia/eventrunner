'use strict';

const { parseEventPublicBase } = require('shared/config/publicBase');
const { stripEventMount } = require('shared/config/publicPath');
const { hostingOrigin, reservedClientPath, resolveEventPublicBase } = require('./clientHostRecords.cjs');

const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const HOSTNAME = /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/;
const HOSTING_ORIGIN = /^https:\/\/([a-z0-9-]+)\.web\.app$/;

function publicEventTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title && title.length <= 160 && !/\p{Cc}/u.test(title) ? title : null;
}

function validateRouteMap(map, host) {
  routeMapObject(host);
  if (!map || map.host !== host || !Number.isSafeInteger(map.version) || map.version < 1
      || typeof map.exportedAt !== 'string' || !Number.isFinite(Date.parse(map.exportedAt))
      || !Array.isArray(map.routes) || Object.keys(map).length !== 4) {
    throw new Error('The client route map is invalid.');
  }
  const routes = [];
  for (const entry of map.routes) {
    const { mount, publicTitle, hostingOrigin: origin } = entry;
    const base = parseEventPublicBase(`https://${host}${mount}/`);
    const site = HOSTING_ORIGIN.exec(origin)?.[1];
    if (base.mount !== mount || reservedClientPath(mount) || hostingOrigin(site) !== origin
        || Object.keys(entry).length !== 3 || publicEventTitle(publicTitle) !== publicTitle || !publicTitle
        || routes.some((route) => stripEventMount(mount, route.mount) !== null
          || stripEventMount(route.mount, mount) !== null || route.hostingOrigin === origin)) {
      throw new Error('The client route map contains an invalid or conflicting event.');
    }
    routes.push({ ...base, publicTitle, hostingOrigin: origin, state: 'published' });
  }
  return { version: map.version, exportedAt: map.exportedAt, routes };
}

/** Build the public projection from one approved host and its enrolled records. */
function projectRouteMap({ host, revision }, enrollments, exportedAt) {
  const routes = enrollments.filter(({ record }) => record.state === 'published').map(({ record, identity }) => {
    const base = resolveEventPublicBase(record, identity);
    if (record.host !== host || base.publicBase !== record.publicBase) throw new Error('The published event address is invalid.');
    return { mount: base.mount, publicTitle: record.publicTitle, hostingOrigin: record.hostingOrigin };
  });
  routes.sort((left, right) => left.mount.localeCompare(right.mount, 'en'));
  const map = { host, version: revision, exportedAt, routes };
  validateRouteMap(map, host);
  return map;
}

function routeMapObject(host) {
  if (typeof host !== 'string' || !HOSTNAME.test(host) || host.length > 253) throw new Error('Invalid client hostname.');
  return `${host}.json`;
}

function createRouteMapReader({ bucket, fetchMap = fetch }) {
  if (typeof bucket !== 'string' || !BUCKET_NAME.test(bucket)) throw new Error('The client route map bucket is missing or invalid.');
  return async (host) => {
    if (!HOSTNAME.test(host) || host.length > 253) return null;
    const response = await fetchMap(`https://storage.googleapis.com/${bucket}/${routeMapObject(host)}`, {
      redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (response.status === 200) return response.json();
    void response.body?.cancel().catch(() => {});
    if (response.status === 404) return null;
    throw Object.assign(new Error('The client route map is unavailable.'), { code: response.status });
  };
}

module.exports = { createRouteMapReader, projectRouteMap, publicEventTitle, routeMapObject, validateRouteMap };
