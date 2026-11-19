#!/usr/bin/env node
'use strict';

const HOST = 'https://er1063-rehearsal.eventrunner.org';
const EVENTS = {
  a: { name: 'rehearsal-nov4', project: 'er-rehearsal-nov4', mount: '/conference', title: 'Rehearsal Conference' },
  b: { name: 'fresh-nov11-ae21', project: 'er-fresh-nov11-ae21', mount: '/events/workshop', title: 'Rehearsal Workshop' },
};
const PHASES = {
  empty: [],
  'staged-a': ['a:staged'],
  'staged-a-with-b': ['a:staged', 'b:visible'],
  'only-a': ['a:visible'],
  'staged-b': ['a:visible', 'b:staged'],
  'only-b': ['b:visible'],
  both: ['a:visible', 'b:visible'],
};
const DETAILS = 'rehearsal-details';
const STATUS_PATH = '/.well-known/eventrunner-route-map';

class RehearsalFailure extends Error {}

function check(condition, label) {
  if (!condition) throw new RehearsalFailure(label);
}

function eventBase(id, mode) {
  const event = Object.hasOwn(EVENTS, id) && EVENTS[id];
  check(event && ['root', 'mounted'].includes(mode), 'Choose event a or b and root or mounted');
  return mode === 'root' ? `https://${event.name}.eventrunner.org/` : `${HOST}${event.mount}/`;
}

async function request(fetchImpl, url, label, status, init) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(8000) });
  } catch {
    throw new RehearsalFailure(`${label}: request failed`);
  }
  check(response.status === status, `${label}: expected HTTP ${status}, received ${response.status}`);
  return response;
}

async function probeEdge(fetchImpl, phase, version) {
  check(Object.hasOwn(PHASES, phase) && /^[1-9]\d*$/.test(version), 'Supply a phase and the operator receipt version');
  const status = await request(fetchImpl, HOST + STATUS_PATH, 'map receipt', 200);
  const receipt = await status.json();
  check(String(receipt.version) === version && Number.isFinite(Date.parse(receipt.exportedAt)), 'Map revision mismatch');
  check(/\bno-store\b/.test(status.headers.get('cache-control') || ''), 'Map receipt must use no-store');
  const index = await (await request(fetchImpl, HOST, 'client index', 200)).text();
  const robots = (await (await request(fetchImpl, `${HOST}/robots.txt`, 'client robots', 200)).text()).split(/\r?\n/);
  for (const [id, event] of Object.entries(EVENTS)) {
    const visible = PHASES[phase].includes(`${id}:visible`);
    const staged = PHASES[phase].includes(`${id}:staged`);
    const routed = visible || staged;
    const { mount, title } = event;
    check(index.includes(`href="${mount}/"`) === visible && index.includes(title) === visible,
      `${id}: wrong public listing`);
    check(robots.includes(`Sitemap: ${HOST}${mount}/sitemap.xml`) === visible, `${id}: wrong sitemap discovery`);
    check(robots.includes(`Disallow: ${mount}$`) === staged && robots.includes(`Disallow: ${mount}/`) === staged,
      `${id}: wrong staged crawler exclusion`);
    check(robots.some((line) => line.startsWith(`Disallow: ${mount}/admin`)) === visible,
      `${id}: wrong admin crawler exclusion`);
    const bare = await request(fetchImpl, `${HOST}${mount}?check=rehearsal`, `${id}: bare mount`, routed ? 308 : 404);
    if (routed) check(bare.headers.get('location') === `${mount}/?check=rehearsal`, `${id}: canonical redirect`);
    await request(fetchImpl, `${HOST}${mount}-other/`, `${id}: path boundary`, 404);
  }
  await request(fetchImpl, `${HOST}/unknown-event/`, 'unknown event', 404);
  await request(fetchImpl, `${HOST}/__/auth/handler`, 'reserved host helper', 404);
  return { phase, version: receipt.version, exportedAt: receipt.exportedAt };
}

async function probeCors(fetchImpl, id) {
  check(Object.hasOwn(EVENTS, id), 'Choose event a or b');
  for (const endpoint of ['sendOtpCode', 'verifyOtpCode']) {
    for (const origin of [HOST, new URL(eventBase(id, 'root')).origin,
      `https://${EVENTS[id].project}.web.app`, 'https://unrelated.example.test']) {
      const url = `https://us-central1-${EVENTS[id].project}.cloudfunctions.net/${endpoint}`;
      const response = await request(fetchImpl, url, endpoint, 204, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-firebase-appcheck',
        },
      });
      const allowed = origin === 'https://unrelated.example.test' ? null : origin;
      check(response.headers.get('access-control-allow-origin') === allowed, `${endpoint}: wrong CORS origin`);
      if (allowed) {
        const headers = response.headers.get('access-control-allow-headers') || '';
        check(/\bx-firebase-appcheck\b/i.test(headers), `${endpoint}: missing App Check CORS header`);
      }
    }
  }
}

async function probeUnsubscribe(fetchImpl, id, mode, action, signedLink) {
  const expected = new URL('unsubscribe', eventBase(id, mode));
  let link;
  try {
    link = new URL(signedLink.trim());
  } catch {
    throw new RehearsalFailure('Expected a signed synthetic unsubscribe link on stdin');
  }
  check(link.origin === expected.origin && link.pathname === expected.pathname
    && !link.username && !link.password && !link.hash, 'Refusing link outside the selected fixture');
  const query = link.searchParams;
  check([...query.keys()].length === 3 && /^[A-Za-z0-9_-]{8,64}$/.test(query.get('s') || '')
    && /^[0-9a-f]{64}$/.test(query.get('r') || '') && /^[A-Za-z0-9_-]{43}$/.test(query.get('t') || ''),
  'Expected the signed fixture link');
  if (action === 'invalid') query.set('t', (query.get('t')[0] === 'a' ? 'b' : 'a') + query.get('t').slice(1));
  const post = action === 'one-click';
  check(post || ['confirm', 'invalid'].includes(action), 'Choose confirm, invalid or one-click');
  const response = await request(fetchImpl, link, 'synthetic unsubscribe', action === 'invalid' ? 400 : 200,
    post ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    } : undefined);
  check(/\bno-store\b/.test(response.headers.get('cache-control') || ''), 'Unsubscribe must use no-store');
  check(/\bnoindex\b/i.test(response.headers.get('x-robots-tag') || ''), 'Unsubscribe must use noindex');
  const title = { confirm: 'Unsubscribe from announcements', invalid: 'This link is not valid', 'one-click': 'You are unsubscribed' };
  check((await response.text()).includes(title[action]), 'Unexpected unsubscribe response');
}

async function checkBrowser(page, id, mode, updateId, updateTitle) {
  const base = eventBase(id, mode);
  check(/^[a-zA-Z0-9_-]+$/.test(updateId || '') && updateTitle, 'Supply the published fixture update ID and title');
  const assets = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes('/assets/') && /\.m?js$/.test(url.pathname)) {
      assets.push({ url, ok: response.ok() });
    }
  });
  const publicPage = new URL(DETAILS, base);
  const published = await page.goto(publicPage.href);
  check(published?.ok() && page.url() === publicPage.href, 'Direct CMS page did not stay on the event');
  const publishedHtml = await published.text();
  check(publishedHtml.includes(`rel="canonical" href="${publicPage.href}"`)
    && publishedHtml.includes(`property="og:url" content="${publicPage.href}"`), 'Public page metadata lost its event base');
  const heading = page.getByRole('heading', { name: 'Rehearsal details', exact: true });
  await heading.waitFor({ state: 'visible' });
  await page.reload();
  await heading.waitFor({ state: 'visible' });
  const update = new URL(`updates/${updateId}`, base);
  const rendered = await page.goto(update.href);
  check(rendered?.ok() && page.url() === update.href, 'Direct update did not stay on the event');
  await page.getByRole('heading', { name: updateTitle, exact: true }).waitFor({ state: 'visible' });
  const html = await rendered.text();
  check(html.includes(`rel="canonical" href="${update.href}"`)
    && html.includes(`property="og:url" content="${update.href}"`), 'Update metadata lost its event base');
  const privatePage = await page.goto(new URL('signin', base).href);
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor({ state: 'visible' });
  const generic = await privatePage.text();
  check(!generic.includes(updateTitle) && !generic.includes(update.href), 'Private shell exposed update metadata');
  check(/\bnoindex\b/i.test(privatePage.headers()['x-robots-tag'] || ''), 'Private shell must use noindex');
  const event = new URL(base);
  check(new Set(assets.map(({ url }) => url.pathname)).size > 1 && assets.every(({ url, ok }) => (
    ok && url.origin === event.origin && url.pathname.startsWith(`${event.pathname}assets/`)
  )), 'An entry or lazy asset escaped the event or failed to load');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifestUrl = new URL('manifest.webmanifest', base);
  check(manifestHref && new URL(manifestHref, page.url()).href === manifestUrl.href, 'Manifest link lost its event base');
  const manifestResponse = await page.request.get(manifestUrl.href, { maxRedirects: 0 });
  check(manifestResponse.ok(), 'Manifest unavailable on its event path');
  const manifest = await manifestResponse.json();
  check(new URL(manifest.start_url, manifestUrl).href === base && new URL(manifest.scope, manifestUrl).href === base,
    'Manifest start or scope lost the event base');
  check(manifest.icons?.length === 2, 'Manifest must list both event icons');
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestUrl);
    check(url.origin === event.origin && url.pathname.startsWith(event.pathname), 'Manifest icon escaped the event');
    const image = await page.request.get(url.href, { maxRedirects: 0 });
    check(image.ok() && /^image\//.test(image.headers()['content-type'] || ''), 'Manifest icon did not load');
  }
  if (mode === 'mounted') {
    await page.goto(`${HOST}/`);
    const listing = page.getByRole('link', { name: EVENTS[id].title, exact: true });
    check(new URL(await listing.getAttribute('href'), HOST).href === base, 'Index link lost its event base');
    await listing.click();
    await page.waitForURL(base);
  }
}

async function cli([command, ...args]) {
  if (command === 'edge' && args.length === 2) {
    return probeEdge(fetch, ...args);
  }
  if (command === 'cors' && args.length === 1) {
    await probeCors(fetch, ...args);
    return { event: args[0], check: 'cors' };
  }
  if (command === 'unsubscribe' && args.length === 3) {
    check(!process.stdin.isTTY, 'Supply the synthetic link through a private stdin stream');
    const input = await require('node:stream/consumers').text(process.stdin);
    await probeUnsubscribe(fetch, ...args, input);
    return { event: args[0], mode: args[1], check: args[2] };
  }
  if (command === 'browser' && args.length === 6) {
    const [id, mode, engine, form, ...update] = args;
    eventBase(id, mode);
    check(['chromium', 'webkit'].includes(engine) && ['desktop', 'phone'].includes(form), 'Choose the browser and form factor');
    const playwright = require('@playwright/test');
    const browser = await playwright[engine].launch(engine === 'chromium' ? { chromiumSandbox: true } : {});
    try {
      const device = engine === 'webkit' ? 'iPhone 13' : 'Pixel 7';
      const context = await browser.newContext({ ...(form === 'phone' ? playwright.devices[device] : {}), locale: 'en-US' });
      await checkBrowser(await context.newPage(), id, mode, ...update);
      return { event: id, mode, engine, form, browserVersion: browser.version() };
    } finally {
      await browser.close();
    }
  }
  throw new RehearsalFailure('See console/functions/CLIENT_HOST_REHEARSAL.md for commands');
}

if (require.main === module) {
  cli(process.argv.slice(2)).then((result) => {
    console.log(JSON.stringify({ ...result, verifiedAt: new Date().toISOString() }));
  }).catch((error) => {
    // Browser and HTTP exceptions can include request URLs and page content.
    const label = error instanceof RehearsalFailure ? error.message : 'Browser or response parsing failed';
    console.error(`Rehearsal check failed: ${label}`);
    process.exitCode = 1;
  });
}

module.exports = { EVENTS, HOST, checkBrowser, probeCors, probeEdge, probeUnsubscribe };
