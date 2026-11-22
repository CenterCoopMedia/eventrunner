/* global BUILD, clients, self, caches */
// BUILD is emitted from the final Hosting files. Runtime traffic never adds
// a response to Cache Storage.
const scope = new URL(self.registration.scope);
const cachePrefix = `eventrunner-public:${BUILD.project}:${scope.pathname}:`;
const cacheName = cachePrefix + BUILD.id;
const shellUrl = new URL('app-shell.html', scope).href;
const receiptUrl = new URL('offline-complete', scope).href;
const policyUrl = new URL('offline-policy.json', scope).href;
const routes = new Set(BUILD.routes);
const clientBuilds = new Map();
let policyCheck;
let disabled = false;
let approveDownload;
let downloadApproved = false;

const owned = async () => (await caches.keys()).filter((key) => key.startsWith(cachePrefix));

function inScope(url) {
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
}

function publicNavigation(url) {
  const route = ('/' + url.pathname.slice(scope.pathname.length)).replace(/\/$/, '') || '/';
  return routes.has(route) && !url.searchParams.has('preview') && url.searchParams.get('eventrunner-live') !== '1';
}

async function readPolicy() {
  const response = await fetch(policyUrl, {
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Offline policy is unavailable');
  }
  const policy = await response.json();
  if (typeof policy.enabled !== 'boolean') throw new Error('Invalid offline policy');
  return policy.enabled;
}

async function windows() {
  return (await clients.matchAll({ type: 'window' })).filter((client) => inScope(new URL(client.url)));
}

async function turnOff() {
  disabled = true;
  await self.registration.unregister();
  await Promise.all((await owned()).map((key) => caches.delete(key)));
  for (const client of await clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    if (inScope(new URL(client.url))) client.postMessage({ type: 'public-offline-disabled' });
  }
}

async function receipt(name) {
  const response = await caches.match(receiptUrl, { cacheName: name });
  return response ? response.json() : null;
}

function savedShell(text, headers, savedAt) {
  const marker = `<meta name="eventrunner-saved-build" content="${BUILD.id}|${savedAt}|${BUILD.generatedAt ?? ''}">`;
  const result = text.replace('</head>', `${marker}</head>`);
  if (result === text) throw new Error('Neutral shell has no head');
  const outputHeaders = new Headers(headers);
  outputHeaders.delete('content-encoding');
  outputHeaders.delete('content-length');
  return new Response(result, { headers: outputHeaders });
}

async function install() {
  if (scope.pathname !== BUILD.base || !routes.size || BUILD.bytes > BUILD.maxBytes) {
    throw new Error('Public offline build is outside its scope or size limit');
  }
  if (!await readPolicy()) throw new Error('Public offline copies are disabled');
  if (await receipt(cacheName)) return;
  if (self.navigator?.connection?.saveData && !downloadApproved) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        approveDownload = undefined;
        reject(new Error('Save-Data requires a download request'));
      }, 10_000);
      approveDownload = () => {
        clearTimeout(timeout);
        approveDownload = undefined;
        resolve();
      };
    });
  }
  // A revision uses a separate cache. Publish its receipt only after every
  // file matches the bytes from the same deployment.
  const cache = await caches.open(cacheName);
  try {
    let shell;
    for (const { file, hash, size } of BUILD.assets) {
      const url = new URL(file, scope);
      if (!inScope(url) || url.search || url.hash) throw new Error('Offline asset is outside the event');
      const response = await fetch(url, {
        credentials: 'omit', cache: 'no-store', redirect: 'error', priority: 'low',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Offline asset unavailable: ${file}`);
      const contents = await response.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', contents)),
        (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (contents.byteLength !== size || hash !== digest) throw new Error(`Offline asset changed: ${file}`);
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      if (url.href === shellUrl) shell = { text: new TextDecoder().decode(contents), headers };
      else await cache.put(url, new Response(contents, { headers }));
    }
    if (!await readPolicy()) throw new Error('Public offline copies were disabled during download');
    const savedAt = new Date().toISOString();
    await cache.put(shellUrl, savedShell(shell.text, shell.headers, savedAt));
    await cache.put(receiptUrl, Response.json({ savedAt, id: BUILD.id }));
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
}

function revalidate() {
  if (!policyCheck) {
    policyCheck = readPolicy().then(async (enabled) => {
      if (!enabled) await turnOff();
      else if (!self.navigator?.connection?.saveData) await self.registration.update();
    }).catch(() => {
      // An unavailable policy or an interrupted update leaves the active set.
    }).finally(() => { policyCheck = undefined; });
  }
  return policyCheck;
}

async function cleanOlder() {
  const open = await windows();
  // A newly activated or restarted worker can get a request before a tab
  // describes its document. Keep older sets until all open tabs are known.
  if (open.some(({ id }) => !clientBuilds.has(id))) return;
  const inUse = new Set(open.map(({ id }) => clientBuilds.get(id)));
  const active = await receipt(cacheName);
  if (!active) return;
  for (const key of await owned()) {
    const older = await receipt(key);
    if (older && older.savedAt < active.savedAt && !inUse.has(older.id)) await caches.delete(key);
  }
  for (const id of clientBuilds.keys()) {
    if (!open.some((client) => client.id === id)) clientBuilds.delete(id);
  }
}

async function navigation(event) {
  const saved = !disabled && await caches.match(shellUrl, { cacheName });
  if (!saved) return fetch(event.request);
  if (event.resultingClientId) clientBuilds.set(event.resultingClientId, BUILD.id);
  return saved;
}

async function asset(event) {
  if (disabled) return fetch(event.request);
  const name = cachePrefix + (clientBuilds.get(event.clientId) || BUILD.id);
  const match = (name === cacheName || await receipt(name))
    && await caches.match(event.request, { cacheName: name });
  if (match) return match;
  // A restarted worker can serve an old, content-addressed chunk before
  // that document reports its build. Partial downloads have no receipt.
  if (/\/assets\/[\w.-]+\.(?:js|css)$/.test(event.request.url)) {
    for (const key of await owned()) {
      if (key === name || !await receipt(key)) continue;
      const previous = await caches.match(event.request, { cacheName: key });
      if (previous) return previous;
    }
  }
  return fetch(event.request);
}

self.addEventListener('install', (event) => event.waitUntil(install()));
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !inScope(url) || disabled) return;
  if (request.mode === 'navigate') {
    if (!publicNavigation(url)) return;
    event.respondWith(navigation(event));
    event.waitUntil(revalidate());
    return;
  }
  if (url.search || request.headers.has('range')) return;
  if (/^(?:assets\/[\w.-]+\.(?:js|css)|fonts\/[\w-]+\.woff2|branding\/favicon\.svg|manifest\.webmanifest)$/
    .test(url.pathname.slice(scope.pathname.length))) event.respondWith(asset(event));
});
self.addEventListener('message', (event) => {
  if (disabled || !event.source?.url || !inScope(new URL(event.source.url))) return;
  if (event.data?.type === 'public-offline-download') {
    downloadApproved = true;
    approveDownload?.();
  }
  if (event.data?.type === 'public-offline-use-update') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'public-offline-document') {
    const { id } = event.data;
    clientBuilds.set(event.source.id, /^[a-f0-9]{64}$/.test(id) ? id : null);
    event.waitUntil(cleanOlder());
  }
  if (event.data?.type === 'public-offline-check') event.waitUntil(revalidate());
});
