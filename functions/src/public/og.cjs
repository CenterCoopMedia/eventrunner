'use strict';

/**
 * updatesMeta — SSR OG-tag function for individual update posts (spec §9
 * "Updates + SSR OG", issue #27). Config-driven port of the reference
 * implementation's `updatesMeta`.
 *
 * Social crawlers (Facebook/Slack/Twitter-Bluesky link unfurlers, etc.) do
 * not execute JavaScript, so the SPA's client-rendered `<title>`/meta tags
 * never reach them — every update link would unfurl with the same generic
 * card. This function serves the SAME hosting HTML a browser gets, with
 * per-post `<title>`/OG/Twitter meta tags substituted in, so a crawler
 * hitting `/updates/:id` sees a correct preview while a real browser still
 * gets the ordinary SPA shell (the injected tags do not change how React
 * boots or routes — `<head>` content is inert to client-side routing).
 *
 * Self-fetch-template mechanism (ports as-is): rather than bundling a copy
 * of `index.html` into the function — which would drift the moment a
 * frontend deploy changes a Vite-hashed asset filename — this fetches the
 * REAL deployed `index.html` from hosting at `EVENT_PUBLIC_URL` and treats
 * that as the template. The fetch result is cached per container with a
 * TTL (mirrors core/config.cjs's pattern) so a hot container is not
 * re-fetching the template on every crawl. That cache is exactly why the
 * deploy pipeline's `post` job (deploy-client.yml) redeploys this function
 * again AFTER hosting deploys: a container that cold-started (and so
 * cached its template) BEFORE the new hosting build went out would keep
 * serving crawlers the previous build's asset references for its whole
 * cache TTL otherwise. Forcing a fresh deploy forces a fresh cold start,
 * which fetches the just-published template immediately.
 *
 * Gated behind `config/features.updates`, same flag-gate pattern as
 * buildSchedulePdf (functions/src/schedule/pdf.cjs) — a disabled feature
 * answers not-found rather than describing content the event has turned
 * off. Post lookup requires `visible === true` STRICTLY, not `!== false`:
 * this handler runs on the Admin SDK, which bypasses firestore.rules
 * entirely, so a doc with the field merely absent (never explicitly set
 * true) must not read as published.
 */

const TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;
let templateCache = null; // { loadedAt, html }

/** Test hook: drop the per-container template cache. */
function resetTemplateCacheForTest() {
  templateCache = null;
}

/**
 * Self-fetch the deployed hosting `index.html` as the SSR template, cached
 * per container with a TTL. `forceRefresh` bypasses the cache (used by
 * tests, and available to an operator debugging a stale-template report).
 *
 * @param {{ publicUrl: string, now?: () => number, forceRefresh?: boolean,
 *           fetchImpl?: typeof fetch }} args
 * @returns {Promise<string>}
 * @throws when the template cannot be fetched at all (no fallback — a
 *   crawler is better served by a 5xx than by fabricated HTML)
 */
async function fetchTemplate({ publicUrl, now = Date.now, forceRefresh = false, fetchImpl = fetch }) {
  if (!forceRefresh && templateCache && now() - templateCache.loadedAt < TEMPLATE_CACHE_TTL_MS) {
    return templateCache.html;
  }
  const base = typeof publicUrl === 'string' ? publicUrl.replace(/\/+$/, '') : '';
  const res = await fetchImpl(`${base}/index.html`);
  if (!res.ok) {
    throw new Error(`self-fetch of index.html failed: HTTP ${res.status}`);
  }
  const html = await res.text();
  templateCache = { loadedAt: now(), html };
  return html;
}

// ------------------------------------------------------------------ pure

/** @param {*} v @returns {boolean} */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Escape a string for safe interpolation into an HTML attribute value
 * (meta `content="..."`) or text node. `&` first, so escaping the other
 * characters cannot introduce a second `&` that later decodes wrong.
 *
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
  const s = typeof value === 'string' ? value : '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** First `maxLen` characters of a plain-text excerpt, word-boundary trimmed. */
function excerpt(text, maxLen = 200) {
  if (!isNonEmptyString(text)) return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Resolve the meta values for one response: either a specific update's
 * meta (when the doc exists and is visible) or the event-level fallback
 * (missing doc, hidden doc, or no id requested at all — e.g. `/updates`
 * itself, which is a list page with no single post to describe).
 *
 * @param {{ event: object | null, update: object | null, canonicalUrl: string }} args
 * @returns {{ title: string, description: string, url: string, siteName: string }}
 */
function resolveMeta({ event, update, canonicalUrl }) {
  const siteName = isNonEmptyString(event?.name) ? event.name.trim() : 'Event updates';
  if (update && isNonEmptyString(update.title)) {
    return {
      title: `${update.title.trim()} · ${siteName}`,
      description: excerpt(update.body) || (isNonEmptyString(event?.tagline) ? event.tagline.trim() : ''),
      url: canonicalUrl,
      siteName,
    };
  }
  return {
    title: siteName,
    description: isNonEmptyString(event?.tagline) ? event.tagline.trim() : '',
    url: canonicalUrl,
    siteName,
  };
}

const TITLE_RE = /<title>[\s\S]*?<\/title>/i;
const HEAD_CLOSE_RE = /<\/head>/i;

/**
 * Inject per-post OG/Twitter meta tags (and replace `<title>`) into the
 * self-fetched hosting template. Every interpolated value is
 * {@link escapeHtml}-escaped — `update.title`/`update.body` are admin
 * editorial content, not attacker input, but a title containing `"` or
 * `<` must not break the tag it is injected into either way.
 *
 * @param {{ template: string, meta: { title: string, description: string,
 *           url: string, siteName: string } }} args
 * @returns {string}
 */
function buildOgHtml({ template, meta }) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const url = escapeHtml(meta.url);
  const siteName = escapeHtml(meta.siteName);

  const tags = [
    `<title>${title}</title>`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:site_name" content="${siteName}">`,
    `<meta property="og:type" content="article">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
  ].join('\n    ');

  let html = template;
  // Replace an existing <title> rather than doubling it — most SPA
  // templates ship a static one for first paint before hydration.
  html = TITLE_RE.test(html) ? html.replace(TITLE_RE, `<title>${title}</title>`) : html;
  const metaOnly = tags.replace(/^<title>.*<\/title>\n\s*/, '');
  html = HEAD_CLOSE_RE.test(html)
    ? html.replace(HEAD_CLOSE_RE, `    ${metaOnly}\n  </head>`)
    : `${html}\n${metaOnly}`;
  return html;
}

/** Update id from the request: `/updates/:id` path, or `?id=`. */
function requestedUpdateId(req) {
  const pathMatch = typeof req.path === 'string' ? req.path.match(/\/updates\/([^/?#]+)/) : null;
  if (pathMatch) return decodeURIComponent(pathMatch[1]);
  const queryId = req.query?.id;
  return typeof queryId === 'string' && queryId ? queryId : null;
}

// -------------------------------------------------------------------- http

const { methodNotAllowed, notFound, internal } = require('../core/errors.cjs');

/**
 * @param {{ db: FirebaseFirestore.Firestore, getConfig: () => Promise<object>,
 *           fetchTemplateFn?: typeof fetchTemplate, now?: () => number,
 *           log?: Pick<Console, 'error'> }} deps
 */
function createUpdatesMetaHandler({
  db,
  getConfig,
  fetchTemplateFn = fetchTemplate,
  now = Date.now,
  log = console,
}) {
  return async function updatesMeta(req, res) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    try {
      const config = await getConfig();
      // Same flag-gate pattern as buildSchedulePdf (functions/src/schedule/
      // pdf.cjs): a disabled feature answers not-found, not a crawl of
      // whatever content happens to still exist in Firestore.
      if (config?.features?.updates !== true) {
        return notFound(res, 'Updates are not enabled for this event.');
      }

      const publicUrl = config?.tierA?.publicUrl;
      if (!isNonEmptyString(publicUrl)) {
        return internal(res, 'The site is not configured with a public URL.');
      }

      const id = requestedUpdateId(req);
      let update = null;
      if (id) {
        // Live cmsUpdates doc only, and STRICTLY visible === true — the
        // Admin SDK bypasses firestore.rules entirely, so an absent
        // `visible` field must not read as published (a `!== false` check
        // would treat a doc mid-write, before the field is set, as
        // published). Same visibility contract as every other cms* read.
        const snap = await db.collection('cmsUpdates').doc(id).get();
        if (snap.exists && snap.data()?.visible === true) update = snap.data();
      }

      const base = publicUrl.replace(/\/+$/, '');
      const canonicalUrl = id ? `${base}/updates/${encodeURIComponent(id)}` : base;
      const meta = resolveMeta({ event: config.event, update, canonicalUrl });

      const template = await fetchTemplateFn({ publicUrl, now });
      const html = buildOgHtml({ template, meta });

      res.status(200);
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      log.error('updatesMeta failed', err);
      internal(res, 'The page preview could not be generated.');
    }
  };
}

/** Deployable export: updatesMeta (public GET, spec §9). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, getConfig: () => getEventConfig({ db }) };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods: ['GET'],
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    updatesMeta: onRequest({ region }, withCors(async (req, res) => {
      await createUpdatesMetaHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  createUpdatesMetaHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    escapeHtml,
    excerpt,
    resolveMeta,
    buildOgHtml,
    fetchTemplate,
    requestedUpdateId,
    resetTemplateCacheForTest,
    TEMPLATE_CACHE_TTL_MS,
  },
};
