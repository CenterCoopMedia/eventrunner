'use strict';

const { joinEventPath, stripEventMount } = require('shared/config/publicPath');
const { reservedClientPath } = require('./clientHostRecords.cjs');

const ABSOLUTE_HTTPS = /^https:\/\/([^/?#\\@%\s]+)([^?#]*)(\?[^#]*)?$/;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const FORWARDED_HEADERS = [
  'accept', 'accept-language', 'content-type', 'if-modified-since', 'if-none-match', 'if-range', 'range',
];
const HOST_SCOPED_HEADERS = ['clear-site-data', 'refresh', 'set-cookie', 'strict-transport-security'];
const MAX_REDIRECTS = 4;
const UPSTREAM_TIMEOUT_MS = 10000;

function isEncodedUnreserved(escape) {
  return /^[a-z0-9._~-]$/i.test(String.fromCharCode(Number.parseInt(escape.slice(1), 16)));
}

// The ingress supplies its unnormalized HTTPS request URL. Validate segments
// before URL parsing can erase a separator, escape or traversal segment.
function unambiguousPath(pathname) {
  if (!pathname.startsWith('/') || pathname.includes('//')) return false;
  try {
    return pathname.split('/').every((part) => {
      const segment = decodeURIComponent(part);
      return segment !== '.' && segment !== '..'
        && !/[\\/%]|\p{Cc}/u.test(segment)
        && !(part.match(/%[\da-f]{2}/gi) ?? []).some(isEncodedUnreserved);
    });
  } catch {
    return false;
  }
}

function routingUrl(rawUrl) {
  const raw = ABSOLUTE_HTTPS.exec(rawUrl);
  if (!raw || raw[0] !== rawUrl || /\p{Cc}/u.test(rawUrl)) return null;
  const [, authority, path = '', query = ''] = raw;
  const pathname = path || '/';
  if (!unambiguousPath(pathname)) return null;
  const url = URL.parse(rawUrl);
  if (!url || url.host !== authority || url.port || url.pathname !== pathname
      || (query !== '?' && url.search !== query)) return null;
  return { url, query };
}

function message(method, status, body, headers = {}) {
  return new Response(method === 'HEAD' ? null : `${body}\n`, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8', ...headers },
  });
}

function unavailable(method) {
  return message(method, 503, 'The event service is temporarily unavailable. Try again shortly.');
}

function eventPath(pathname) {
  return pathname.split('/')[1] !== '__';
}

function discard(response) {
  void response.body?.cancel().catch(() => {});
}

function redirectTarget(location, current, route, routes) {
  if (!location || /[#\\\s]|\p{Cc}/u.test(location) || location.startsWith('//')) return null;
  const absolute = ABSOLUTE_HTTPS.exec(location);
  const path = absolute ? absolute[2] || '/' : `/${location.split('?')[0].replace(/^\//, '')}`;
  if (!unambiguousPath(path)) return null;
  const url = URL.parse(location, current);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.origin === route.origin) {
    const pathname = stripEventMount(url.pathname, route.mount);
    return pathname && eventPath(pathname) ? `${pathname}${url.search}` : null;
  }
  if (url.origin !== route.hostingOrigin || !eventPath(url.pathname)
      || routes.some((entry) => entry.mount !== route.mount && stripEventMount(url.pathname, entry.mount) !== null)) {
    return null;
  }
  return `${url.pathname}${url.search}`;
}

async function fetchHeaders(fetchUpstream, url, options, deadline) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  try {
    return await fetchUpstream(url, { ...options, signal: AbortSignal.any([options.signal, controller.signal]) });
  } finally {
    clearTimeout(timer);
  }
}

/** Follow only checked GET/HEAD locations on the fixed origin before emitting a public redirect. */
async function forwardEvent(request, path, route, routes, fetchUpstream, fail) {
  const { method } = request;
  // Node Fetch decodes compressed bodies but leaves the encoding headers.
  const headers = new Headers({ 'accept-encoding': 'identity' });
  for (const name of FORWARDED_HEADERS) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  const options = {
    method, headers, redirect: 'manual', cache: 'no-store',
    signal: request.signal,
    ...(method === 'POST' ? { body: request.body, duplex: 'half' } : {}),
  };
  const visited = new Set();
  const deadline = Date.now() + UPSTREAM_TIMEOUT_MS;
  let current = new URL(path, route.hostingOrigin);
  let redirect;
  while (visited.size <= MAX_REDIRECTS && !visited.has(current.href)) {
    visited.add(current.href);
    const response = await fetchHeaders(fetchUpstream, current.href, options, deadline);
    if (response.status >= 500) {
      discard(response);
      return fail('hosting-status', response.status);
    }
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const target = method !== 'POST' && REDIRECTS.has(response.status)
        && redirectTarget(response.headers.get('location'), current, route, routes);
      discard(response);
      if (!target) return fail('redirect-refused', response.status);
      redirect ??= { status: response.status, headers: new Headers(response.headers) };
      current = new URL(target, route.hostingOrigin);
      continue;
    }

    const output = new Headers(redirect?.headers ?? response.headers);
    for (const name of HOST_SCOPED_HEADERS) output.delete(name);
    if (output.has('service-worker-allowed')) output.set('service-worker-allowed', route.assetBase);
    if (redirect) {
      discard(response);
      output.set('location', `${joinEventPath(route.assetBase, current.pathname)}${current.search}`);
      output.delete('content-encoding');
      output.delete('content-length');
      return new Response(null, { ...redirect, headers: output });
    }
    output.delete('location');
    if (response.body && method !== 'HEAD' && ![null, 'identity'].includes(output.get('content-encoding'))) {
      discard(response);
      return fail('unexpected-content-encoding', response.status);
    }
    if (method === 'HEAD') discard(response);
    return new Response(method === 'HEAD' ? null : response.body, {
      status: response.status, statusText: response.statusText, headers: output,
    });
  }
  return fail('redirect-loop-or-limit');
}

/** loadHost supplies normalized routes with the public-base fields, or null for an unregistered host. */
function createClientHostRouter({ loadHost, handleHostRequest = () => null, fetchUpstream = fetch, log = console }) {
  return async (request, rawUrl) => {
    const { method } = request;
    const parsed = routingUrl(rawUrl);
    if (!parsed) return message(method, 400, 'Invalid request path.');
    const { url, query } = parsed;
    let mount;
    let phase = 'registry';
    const fail = (reason, upstreamStatus) => {
      log.warn('Client-host routing failed', { reason, host: url.hostname, mount, upstreamStatus });
      return unavailable(method);
    };
    try {
      const host = await loadHost(url.hostname);
      const notFound = () => message(method, 404, 'Event not found.');
      if (!host) return notFound();
      const matches = reservedClientPath(url.pathname) ? [] : host.routes.filter((route) =>
        stripEventMount(url.pathname, route.mount) !== null);
      if (matches.length === 0) {
        phase = 'host-handler';
        return await handleHostRequest(request, url, host) ?? notFound();
      }
      if (matches.length !== 1) return fail('overlapping-mounts');
      const [route] = matches;
      if (route.state !== 'published') return notFound();
      mount = route.mount;
      const path = stripEventMount(url.pathname, route.mount);
      const read = method === 'GET' || method === 'HEAD';
      const unsubscribe = path === '/unsubscribe';
      if (!read && !(method === 'POST' && unsubscribe)) {
        return message(method, 405, 'Method not allowed.', { allow: unsubscribe ? 'GET, HEAD, POST' : 'GET, HEAD' });
      }
      if (url.pathname === route.mount) {
        return new Response(null, {
          status: 308, headers: { location: `${route.assetBase}${query}`, 'cache-control': 'no-store' },
        });
      }
      if (!eventPath(path)) return notFound();
      phase = 'hosting-fetch';
      return await forwardEvent(request, `${path}${query}`, route, host.routes, fetchUpstream, fail);
    } catch {
      return request.signal.aborted ? unavailable(method) : fail(phase);
    }
  };
}

module.exports = { createClientHostRouter };
