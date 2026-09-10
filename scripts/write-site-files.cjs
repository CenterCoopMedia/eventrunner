#!/usr/bin/env node
'use strict';

/**
 * Write sitemap.xml, robots.txt, and the web manifest from a generated
 * content snapshot (M7 issue 5 follow-up).
 *
 * scripts/publish-site.cjs already writes these three files, but only from
 * a LIVE Firestore read, and only inside the Cloud Run `site-publisher`
 * job that a CMS publish triggers (functions/src/cms/publisher.cjs). A
 * fresh client deployment, and every ordinary code deploy
 * (.github/workflows/deploy-client.yml), builds the web app straight from
 * a generated snapshot and deploys that `dist/` to hosting without ever
 * running the publisher — so without this script, `apps/web/dist` carried
 * no sitemap.xml or robots.txt until someone happened to publish a
 * content change afterward.
 *
 * One source of truth: this script and scripts/publish-site.cjs both build
 * their output through the same pure functions in
 * scripts/lib/site-manifest.cjs — the difference is only where the input
 * documents come from. This script reads a generated snapshot; publish-
 * site.cjs reads Firestore directly.
 *
 * The snapshot defaults to the committed copy at apps/web/src/generated —
 * the demo's own source of truth (scripts/build-demo.cjs calls this with
 * no --generated for exactly that reason) — but deploy-client.yml's build
 * job points --generated at the real, out-of-tree per-client snapshot
 * generate-content.cjs already wrote earlier in the same workflow run (the
 * `generated-content-<client>` artifact, downloaded into the build job
 * alongside GENERATED_DIR).
 *
 * apps/web/src/generated/*.js are ES modules — Vite's own source, not
 * Node's — so they are loaded with dynamic `import()` here rather than
 * `require()`. cmsUpdates has no generated-snapshot counterpart at all
 * (Updates.jsx reads it through a live Firestore listener, never the
 * build-time snapshot — see scripts/lib/emit.cjs), so update detail
 * routes are always empty from this path; only the Cloud Run publisher,
 * which does have a live read, can list them.
 *
 * One route is refused outright: the specimen book at /specimen is a review
 * surface that ships only in the demo build and in a development server, so
 * a sitemap that lists it fails this script with exit code 4 rather than
 * publishing it. `specimen` is reserved in shared/routing for the same
 * reason, so a page written after that landed cannot take the segment; the
 * refusal below names the page path anyway, because a page written before
 * it can, and renaming that page is the fix.
 *
 * Usage:
 *   node scripts/write-site-files.cjs --dist apps/web/dist --public-url https://example.org
 *   node scripts/write-site-files.cjs --dist apps/web/dist --generated /tmp/generated --public-url https://example.org
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { buildSiteArtifacts } = require('./lib/site-manifest.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_GENERATED_DIR = path.join(ROOT, 'apps', 'web', 'src', 'generated');
const FLAGS = ['dist', 'generated', 'public-url', 'help'];

/**
 * The review-only routes this build must never advertise.
 *
 * The specimen book (apps/web/src/pages/specimen/) renders every device in
 * every state. It ships in the static demo build and in a development
 * server, never in a client production build, and it is not a page anybody
 * should reach from a search result.
 *
 * A sitemap is built from cmsPages, sessions, speakers, and updates, so no
 * ordinary change can put this path in one. That is exactly why the check
 * belongs here: the day a route table starts feeding the sitemap, this
 * fails instead of quietly publishing a review surface.
 */
const NEVER_IN_SITEMAP = Object.freeze(['/specimen']);

/**
 * The reason each refused route is refused, in the words an operator needs.
 *
 * The segment is reserved in shared/routing, so no page written after that
 * landed can hold it. A page written BEFORE it can, which is the whole
 * reason this message names a path: the operator has to rename that page,
 * and a message that only says "remove it from the route source" names
 * nothing they can act on.
 */
const EXCLUDED_ROUTE_REASONS = Object.freeze({
  '/specimen': 'reserved for the specimen book, the review page that ships in the demo build only',
});

/**
 * Refuse a sitemap that lists a review-only route.
 *
 * @param {string} sitemapXml
 * @param {string[]} [routes]
 * @returns {string[]} the offending routes, empty when the sitemap is clean
 */
function excludedRoutesFound(sitemapXml, routes = NEVER_IN_SITEMAP) {
  const text = String(sitemapXml ?? '');
  return routes.filter((route) => {
    const inLoc = new RegExp(`<loc>[^<]*${route}(?:/[^<]*)?</loc>`, 'u');
    return inLoc.test(text);
  });
}

/**
 * The stored pages sitting on one refused route, by their own path.
 *
 * The sitemap carries absolute URLs; the operator renames a PAGE PATH in
 * the admin. So the offending pages are read from the snapshot the sitemap
 * was built from rather than parsed back out of the XML.
 *
 * @param {object[]} pages the generated pagesData
 * @param {string} route e.g. '/specimen'
 * @returns {string[]} the page paths on that route, in snapshot order
 */
function pagePathsOnRoute(pages, route) {
  return (pages ?? [])
    .map((page) => String(page?.path ?? ''))
    .filter((pagePath) => pagePath === route || pagePath.startsWith(`${route}/`));
}

/**
 * One line per refused route, naming the reason and what to rename.
 *
 * @param {string[]} routes the routes excludedRoutesFound reported
 * @param {object[]} pages the generated pagesData
 * @returns {string}
 */
function excludedRouteMessage(routes, pages) {
  return routes
    .map((route) => {
      const reason = EXCLUDED_ROUTE_REASONS[route] ?? 'a review-only route';
      const taken = pagePathsOnRoute(pages, route);
      const owner = taken.length > 0
        ? `The page at ${taken.join(', ')} took it. Rename that page's path and publish again.`
        : 'Remove it from the route source before publishing.';
      return `the sitemap lists ${route}, and that segment is ${reason}. ${owner}`;
    })
    .join('\n');
}

function usage() {
  return [
    'Usage: node scripts/write-site-files.cjs --dist <dir> --public-url <url> [--generated <dir>]',
    '',
    '  --dist <dir>        directory to write sitemap.xml, robots.txt, and',
    '                      manifest.webmanifest into (usually apps/web/dist)',
    "  --public-url <url>  the site's own absolute base URL",
    '  --generated <dir>   the generated snapshot to read (default:',
    '                      apps/web/src/generated, the committed demo copy)',
  ].join('\n');
}

/**
 * Import one generated ES module from an absolute directory + filename.
 * Test hook: injectable so the read can be pinned to a fixture directory
 * without touching the real generated snapshot.
 *
 * @param {string} dir the generated snapshot directory
 * @param {string} file e.g. 'eventConfig.js'
 * @returns {Promise<object>} the module's exports
 */
async function importGenerated(dir, file) {
  return import(pathToFileURL(path.join(dir, file)).href);
}

/**
 * Read the generated files `buildSiteArtifacts` needs, in its shape.
 *
 * eventConfig.js exports `eventConfig`/`features`/`theme` (spec §2.4);
 * `theme` there is a PROJECTION that deliberately drops `colors` (they go
 * to theme.css as RGB triples instead — scripts/lib/emit.cjs), so a
 * manifest built from a generated snapshot never carries `theme_color`/
 * `background_color`; that is `buildWebManifest`'s existing "only when
 * configured" behavior doing the right thing with what this path can
 * actually see, not a bug in this reader. scheduleData.js exports both
 * `scheduleData` (sessions) and `speakers` — one file, two collections,
 * because scripts/lib/emit.cjs emits them together.
 *
 * @param {{ generatedDir: string, importModule?: typeof importGenerated }} args
 * @returns {Promise<{ event: object, features: object, theme: object,
 *                     pages: object[], sessions: object[], speakers: object[],
 *                     updates: object[] }>}
 */
async function readGeneratedSnapshot({ generatedDir, importModule = importGenerated }) {
  const [eventConfigMod, pagesMod, scheduleMod] = await Promise.all([
    importModule(generatedDir, 'eventConfig.js'),
    importModule(generatedDir, 'pagesData.js'),
    importModule(generatedDir, 'scheduleData.js'),
  ]);
  return {
    event: eventConfigMod.eventConfig || {},
    features: eventConfigMod.features || {},
    theme: eventConfigMod.theme || {},
    pages: pagesMod.pagesData || [],
    sessions: scheduleMod.scheduleData || [],
    speakers: scheduleMod.speakers || [],
    // No build-time snapshot exists for cmsUpdates — see the module
    // docstring above.
    updates: [],
  };
}

/**
 * @param {string[]} argv
 * @param {{ importModule?: typeof importGenerated, log?: Console }} [deps]
 * @returns {Promise<number>} process exit code
 */
async function main(argv, { importModule = importGenerated, log = console } = {}) {
  const parsed = parseArgv(argv, { withValue: ['dist', 'generated', 'public-url'] });
  const unknown = unknownFlags(parsed, FLAGS);
  if (parsed.help) {
    log.log(usage());
    return 0;
  }
  if (unknown.length > 0) {
    log.error(`write-site-files: unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}\n\n${usage()}`);
    return 2;
  }
  if (typeof parsed.dist !== 'string' || !parsed.dist) {
    log.error(`write-site-files: --dist is required.\n\n${usage()}`);
    return 2;
  }
  if (typeof parsed['public-url'] !== 'string' || !parsed['public-url']) {
    log.error(`write-site-files: --public-url is required.\n\n${usage()}`);
    return 2;
  }

  const distDir = path.resolve(parsed.dist);
  const generatedDir = typeof parsed.generated === 'string' && parsed.generated
    ? path.resolve(parsed.generated)
    : DEFAULT_GENERATED_DIR;

  let snapshot;
  try {
    snapshot = await readGeneratedSnapshot({ generatedDir, importModule });
  } catch (err) {
    log.error(
      `write-site-files: could not read the generated snapshot at ${generatedDir}: ${err?.message || err}`,
    );
    return 3;
  }

  const artifacts = buildSiteArtifacts({ ...snapshot, publicUrl: parsed['public-url'] });

  const listed = excludedRoutesFound(artifacts.sitemapXml);
  if (listed.length > 0) {
    log.error(`write-site-files: ${excludedRouteMessage(listed, snapshot.pages)}`);
    return 4;
  }

  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'sitemap.xml'), artifacts.sitemapXml);
  fs.writeFileSync(path.join(distDir, 'robots.txt'), artifacts.robotsTxt);
  fs.writeFileSync(
    path.join(distDir, 'manifest.webmanifest'),
    `${JSON.stringify(artifacts.manifest, null, 2)}\n`,
  );
  log.log(`write-site-files: wrote sitemap.xml, robots.txt, and manifest.webmanifest to ${distDir}`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`write-site-files: ${err?.stack || err}`);
      process.exitCode = 1;
    });
}

module.exports = {
  main,
  readGeneratedSnapshot,
  importGenerated,
  excludedRoutesFound,
  excludedRouteMessage,
  DEFAULT_GENERATED_DIR,
  NEVER_IN_SITEMAP,
  internals: { usage, FLAGS, pagePathsOnRoute },
};
