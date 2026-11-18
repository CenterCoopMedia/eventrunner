'use strict';

const { joinEventPath } = require('shared/config/publicPath');

const TIMEOUT_MS = 5000;
const TEXT = /^text\/plain(?:;|$)/i;
const XML = /^(?:application|text)\/xml(?:;|$)/i;

function discard(response) {
  void response.body?.cancel().catch(() => {});
}

function fetchFile(fetchUpstream, url, method) {
  return fetchUpstream(url, {
    method, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function legacyRules(fallback, url, log) {
  let upstreamStatus;
  try {
    const location = new URL('/robots.txt', url);
    const response = await fallback(new Request(location, { signal: AbortSignal.timeout(TIMEOUT_MS) }), location);
    if (!response) return '';
    upstreamStatus = response.status;
    if (upstreamStatus === 200 && TEXT.test(response.headers.get('content-type') ?? '')) {
      return (await response.text()).trimEnd();
    }
    discard(response);
    if (upstreamStatus === 404) return '';
    throw new Error('The host crawler policy is unavailable.');
  } catch (error) {
    log.warn('Client-host crawler policy unavailable', { host: url.hostname, upstreamStatus });
    throw error;
  }
}

async function sitemapAvailable(route, fetchUpstream) {
  try {
    const response = await fetchFile(fetchUpstream, `${route.hostingOrigin}/sitemap.xml`, 'HEAD');
    discard(response);
    return response.status === 200 && XML.test(response.headers.get('content-type') ?? '');
  } catch {
    // An unavailable sitemap does not change the applicable exclusions.
    return false;
  }
}

async function eventRules(route, fetchUpstream, log) {
  if (route.publicTitle === null) return { rules: [`Disallow: ${route.mount}$`, `Disallow: ${route.assetBase}`] };
  const sitemap = `Sitemap: ${joinEventPath(route.publicBase, '/sitemap.xml')}`;
  let rules;
  let upstreamStatus;
  try {
    const response = await fetchFile(fetchUpstream, `${route.hostingOrigin}/robots.txt`, 'GET');
    upstreamStatus = response.status;
    if (upstreamStatus !== 200 || !TEXT.test(response.headers.get('content-type') ?? '')) {
      discard(response);
      if (upstreamStatus === 404) return { rules: [] };
      throw new Error('The event crawler policy is unavailable.');
    }
    rules = (await response.text()).split(/\r\n|\r|\n/).filter(Boolean);
    if (rules.shift() !== 'User-agent: *' || rules.pop() !== sitemap
        || rules.some((line) => !line.startsWith(`Disallow: ${route.assetBase}`) || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(line))) {
      throw new Error('The event crawler policy does not match its mounted build.');
    }
  } catch (error) {
    log.warn('Event crawler policy unavailable', { host: new URL(route.origin).hostname, mount: route.mount, upstreamStatus });
    throw error;
  }
  return { rules, sitemap: await sitemapAvailable(route, fetchUpstream) ? sitemap : null };
}

async function composeClientRobots({ routes, url, fallback, fetchUpstream, log }) {
  const legacy = await legacyRules(fallback, url, log);
  const events = await Promise.all(routes.map((route) => eventRules(route, fetchUpstream, log)));
  const agents = new Set(['*']);
  for (const match of legacy.matchAll(/^[ \t]*User-agent[ \t]*:[ \t]*([^\s#]+)/gim)) {
    agents.add(match[1].toLowerCase());
  }
  // Each crawler with an existing specific group also receives the mounted rules.
  return [...(legacy ? [legacy, ''] : []), ...[...agents].map((agent) => `User-agent: ${agent}`),
    ...events.flatMap(({ rules }) => rules), '', ...events.flatMap(({ sitemap }) => sitemap ? [sitemap] : []), '',
  ].join('\n');
}

module.exports = { composeClientRobots };
