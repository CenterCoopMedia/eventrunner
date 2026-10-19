#!/usr/bin/env node
'use strict';

/**
 * The public address of the GitHub Pages site (#514).
 *
 * One value says where the site is served: its origin and the path base under
 * it. The documentation generator (scripts/build-pages.cjs), the demo build
 * (scripts/build-demo.cjs), and the link checker (scripts/check-docs.cjs) all
 * read it from here, so the canonical and social card URLs, every
 * root-relative link, the demo's Vite base, and the checker's path mapping
 * move together.
 *
 * The committed default is the project path on github.io. A deploy can serve
 * the site from another address without a code change: set PAGES_BASE_URL
 * (in the Pages workflow, the repository variable of the same name). For the
 * custom domain that value is `https://docs.eventrunner.org/`, which serves
 * from `/`. docs/DEPLOY_RUNBOOK.md §10 gives the order of the switch; setting
 * it before the domain is connected breaks every link on the live site.
 *
 * No dependencies: the documentation CI tier runs on the runner's Node with no
 * `npm ci`.
 *
 * Usage:
 *   node scripts/lib/pages-site.cjs    # print the resolved site URL
 */

/** The project's own GitHub Pages address. GitHub redirects it to a custom domain once one is set. */
const GITHUB_PAGES_URL = 'https://centercoopmedia.github.io/eventrunner/';

/** The address the committed site is built for. The custom domain is `https://docs.eventrunner.org/`. */
const DEFAULT_PAGES_BASE_URL = GITHUB_PAGES_URL;

/**
 * Parse and check one site address.
 *
 * The address must be an https origin with an optional path, and nothing
 * else: a query, a fragment, or credentials would end up in every link. A
 * missing trailing slash is added, because every path here is joined to the
 * base by string concatenation.
 *
 * @param {string} value
 * @returns {{ url: string, origin: string, base: string, docsBase: string,
 *             docsUrl: string, demoBase: string }}
 */
function parsePagesBaseUrl(value) {
  const text = String(value ?? '').trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`PAGES_BASE_URL is not a URL: ${JSON.stringify(text)}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`PAGES_BASE_URL must use https: ${text}`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || text.includes('?') || text.includes('#')) {
    throw new Error(`PAGES_BASE_URL must be an origin and a path only: ${text}`);
  }
  const base = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  if (base.includes('//')) {
    throw new Error(`PAGES_BASE_URL has an empty path segment: ${text}`);
  }
  const origin = parsed.origin;
  return Object.freeze({
    url: `${origin}${base}`,
    origin,
    base,
    docsBase: `${base}docs/`,
    docsUrl: `${origin}${base}docs/`,
    demoBase: `${base}demo/`,
  });
}

/**
 * The site address for this run: PAGES_BASE_URL when it is set and not
 * empty, the committed default otherwise.
 *
 * @param {Record<string, string|undefined>} [env]
 */
function pagesSite(env = process.env) {
  const configured = String(env.PAGES_BASE_URL ?? '').trim();
  return parsePagesBaseUrl(configured || DEFAULT_PAGES_BASE_URL);
}

function main(env = process.env) {
  try {
    console.log(pagesSite(env).url);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  DEFAULT_PAGES_BASE_URL,
  GITHUB_PAGES_URL,
  main,
  pagesSite,
  parsePagesBaseUrl,
};
