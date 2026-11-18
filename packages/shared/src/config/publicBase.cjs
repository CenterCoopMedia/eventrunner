'use strict';

// Validate the raw URL before WHATWG URL parsing can discard or normalize
// path syntax. Slug segments are lowercase ASCII and never percent-encoded.
const PUBLIC_BASE = /^https?:\/\/[^/?#\\@%\s]+(\/.*)?$/i;
const MOUNT_PATH = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*\/?)?$/;
const INVALID_BASE = 'must be an HTTPS URL with an optional lowercase slug path and no credentials, query or fragment';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseEventPublicBase(value, { allowHttpLoopback = false } = {}) {
  if (value === undefined || value === '') {
    return { publicBase: null, origin: null, mount: '', assetBase: '/' };
  }
  const raw = typeof value === 'string' && PUBLIC_BASE.exec(value);
  if (!raw || raw[0] !== value || value.charCodeAt(value.length - 1) <= 32) {
    throw new Error(INVALID_BASE);
  }
  const pathname = raw[1] ?? '/';
  if (!MOUNT_PATH.test(pathname)) throw new Error(INVALID_BASE);
  const url = URL.parse(value);
  if (!url || url.pathname !== pathname) throw new Error(INVALID_BASE);
  if (url.protocol !== 'https:' && !(allowHttpLoopback && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error(INVALID_BASE);
  }

  const mount = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const assetBase = `${mount}/`;
  return { publicBase: `${url.origin}${assetBase}`, origin: url.origin, mount, assetBase };
}

module.exports = { parseEventPublicBase };
