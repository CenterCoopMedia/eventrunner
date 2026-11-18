'use strict';

const MAP_STATUS_PATH = '/.well-known/eventrunner-route-map';
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function eventIndex(routes) {
  const events = routes.map(({ assetBase, publicTitle }) =>
    `<li><a href="${assetBase}">${escapeHtml(publicTitle)}</a></li>`);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Events</title>
</head>
<body><main>
  <h1>Events</h1>
  ${events.length ? `<ul>${events.join('')}</ul>` : '<p>No public events are listed.</p>'}
</main></body>
</html>`;
}

function createPublicHostHandler({ fallback = () => null } = {}) {
  return (request, url, host) => {
    const { pathname } = url;
    if (pathname !== '/' && pathname !== MAP_STATUS_PATH) return fallback(request, url);
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
    }
    const read = request.method === 'GET';
    if (pathname === MAP_STATUS_PATH) {
      headers['content-type'] = 'application/json; charset=utf-8';
      const { version, exportedAt } = host;
      return new Response(read ? JSON.stringify({ version, exportedAt }) : null, { headers });
    }
    headers['content-type'] = 'text/html; charset=utf-8';
    headers['content-security-policy'] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
    return new Response(read ? eventIndex(host.routes) : null, { headers });
  };
}

module.exports = { createPublicHostHandler };
