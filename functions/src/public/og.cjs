'use strict';

/**
 * The two server-rendered metadata functions. `updatesMeta` (below) covers
 * `/updates/**`; `routeMeta` (further down, M7 issue 4) covers every other
 * public route. They share one mechanism — self-fetch the deployed
 * `index.html`, substitute the head tags, serve it — and one per-container
 * template cache, so the deploy ordering note below governs both.
 *
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
 * that as the template. The copy is held per container and REVALIDATED
 * against hosting's ETag rather than trusted for a fixed span, so a
 * deploy is noticed within seconds and a hot container still does no
 * body transfer between deploys ({@link fetchTemplate}).
 *
 * The deploy pipeline's `post` job (deploy-client.yml) still redeploys
 * these functions AFTER hosting deploys, which makes the changeover
 * immediate rather than merely quick.
 *
 * Gated behind `config/features.updates`, same flag-gate pattern as
 * buildSchedulePdf (functions/src/schedule/pdf.cjs) — a disabled feature
 * answers not-found rather than describing content the event has turned
 * off. Post lookup requires `visible === true` STRICTLY, not `!== false`:
 * this handler runs on the Admin SDK, which bypasses firestore.rules
 * entirely, so a doc with the field merely absent (never explicitly set
 * true) must not read as published.
 */

/**
 * How long a just-checked template is trusted without asking hosting
 * again. Not a time-to-live: past the floor the cache is REVALIDATED, not
 * discarded, so the usual answer is a 304 with no body.
 *
 * The floor exists only so a burst — a crawl, or a page that fans out into
 * several requests — does not turn into one conditional request each. Ten
 * seconds is the whole window in which a deploy's new `index.html` can go
 * unnoticed, which is what makes a hosting deploy that does not redeploy
 * these functions survivable rather than a five-minute outage.
 */
const TEMPLATE_REVALIDATE_FLOOR_MS = 10 * 1000;

let templateCache = null; // { html, etag, loadedAt }

/** Test hook: drop the per-container template cache. */
function resetTemplateCacheForTest() {
  templateCache = null;
}

/** The last template this container fetched, or null. */
function lastKnownTemplate() {
  return templateCache ? templateCache.html : null;
}

/**
 * Self-fetch the deployed hosting `index.html` as the SSR template, held
 * per container and revalidated against hosting with `If-None-Match`.
 *
 * The build stamps a new ETag on every hosting deploy, so a 304 means the
 * held copy is still the live one and a 200 means it is not. That is what
 * keeps a container from serving an `index.html` whose Vite-hashed asset
 * files the current release no longer has — the failure the flat cache
 * this replaces could sustain for its whole TTL.
 *
 * Stale-if-error: once a template has been fetched, a hosting request that
 * fails or answers non-2xx serves the held copy rather than throwing.
 * routeMeta is the catch-all rewrite, so a hiccup between the function and
 * hosting must not take the site down; the held copy is at most one deploy
 * behind, and the alternative is a 5xx for every page.
 *
 * `forceRefresh` skips both the floor and the conditional request (used by
 * tests, and available to an operator debugging a stale-template report).
 *
 * @param {{ publicUrl: string, now?: () => number, forceRefresh?: boolean,
 *           fetchImpl?: typeof fetch }} args
 * @returns {Promise<string>}
 * @throws only when nothing has ever been fetched — a first request that
 *   cannot reach hosting has no honest answer, and fabricated HTML is not
 *   one
 */
async function fetchTemplate({ publicUrl, now = Date.now, forceRefresh = false, fetchImpl = fetch }) {
  if (!forceRefresh && templateCache && now() - templateCache.loadedAt < TEMPLATE_REVALIDATE_FLOOR_MS) {
    return templateCache.html;
  }
  const base = typeof publicUrl === 'string' ? publicUrl.replace(/\/+$/, '') : '';
  const conditional = !forceRefresh && templateCache && isNonEmptyString(templateCache.etag);
  const init = conditional ? { headers: { 'If-None-Match': templateCache.etag } } : undefined;

  let res;
  try {
    res = await fetchImpl(`${base}/index.html`, init);
  } catch (err) {
    if (templateCache) return templateCache.html;
    throw err;
  }

  if (res.status === 304 && templateCache) {
    // Unchanged: keep the body, and restart the floor so the next burst
    // does not revalidate again.
    templateCache = { ...templateCache, loadedAt: now() };
    return templateCache.html;
  }
  if (!res.ok) {
    if (templateCache) return templateCache.html;
    throw new Error(`self-fetch of index.html failed: HTTP ${res.status}`);
  }
  const html = await res.text();
  const etag = typeof res.headers?.get === 'function' ? res.headers.get('etag') : null;
  templateCache = { html, etag: isNonEmptyString(etag) ? etag : null, loadedAt: now() };
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
  // Replacer FUNCTIONS, not replacement strings: escapeHtml does not touch
  // `$`, so a title carrying `$&` would otherwise be read as a replacement
  // pattern and inject the matched text instead of itself.
  html = TITLE_RE.test(html) ? html.replace(TITLE_RE, () => `<title>${title}</title>`) : html;
  const metaOnly = tags.replace(/^<title>.*<\/title>\n\s*/, '');
  html = HEAD_CLOSE_RE.test(html)
    ? html.replace(HEAD_CLOSE_RE, () => `    ${metaOnly}\n  </head>`)
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

// -------------------------------------------------- per-route metadata

/**
 * `routeMeta` — the same self-fetch-template mechanism above, applied to
 * every public route instead of only `/updates/:id` (M7 issue 4).
 *
 * Why it exists: `firebase.json` used to rewrite every route except
 * `/updates/**` straight to the static `index.html`, so the only tags any
 * crawler ever saw were the shell's — one generic title for the whole
 * site. The tags the app sets after boot are invisible to a link unfurler
 * and to a search crawler that does not run the page's script. So the
 * server has to put the right tags in the bytes it sends.
 *
 * What it costs, stated plainly: one function invocation on the request
 * path for the FIRST load of a public route. Three things keep that from
 * being a per-reader cost. The response carries {@link ROUTE_CACHE_CONTROL},
 * so the Hosting CDN answers repeat traffic for the same URL rather than
 * the function. The template is the revalidated per-container copy
 * updatesMeta also uses, so a hot container transfers no body between
 * deploys. And the config read is the shared 5-minute container cache
 * (core/config.cjs).
 *
 * Nothing here answers 5xx once a template has been fetched. The site's
 * whole front door is this function: a hosting hiccup, a config read that
 * fails, or an unset `EVENT_PUBLIC_URL` each degrade to the plain shell,
 * which still boots the app and reads its own configuration.
 *
 * Static files still win over rewrites in Hosting, which is what keeps the
 * self-fetch of `/index.html` from recursing back into this function.
 *
 * Authenticated and account routes are NOT rewritten here (see
 * `firebase.json`): they carry nothing to describe, a crawler has no
 * business indexing them, and routing them through a function would spend
 * an invocation to say nothing.
 */

/**
 * Cache-Control for a routeMeta response.
 *
 * `max-age=0` — the browser revalidates. The shell names hashed asset
 * files, so a copy held in one reader's browser across a deploy is the
 * classic way to serve a page whose scripts no longer exist. Nothing
 * permits serving it stale afterwards either, for the same reason.
 *
 * `s-maxage=300` — the Hosting CDN holds it for five minutes, the same
 * window the config container cache uses, and a hosting deploy clears it.
 * A publish reaches social previews within that window rather than at the
 * next cold start.
 */
const ROUTE_CACHE_CONTROL = 'public, max-age=0, s-maxage=300';

/**
 * The feature flag that gates each system route's first path segment. A
 * route whose flag is off describes nothing: the app renders a disabled
 * state there, and a card that advertises content the event has turned off
 * is worse than no card. Same reasoning as updatesMeta's `features.updates`
 * gate.
 *
 * `/attendees` is absent on purpose: the directory is behind sign-in, so
 * `firebase.json` rewrites it to the static shell and no request for it
 * ever reaches this function. `/updates` is present because the
 * `/updates/**` rewrite does not claim the bare list route.
 */
const SEGMENT_FEATURES = Object.freeze({
  schedule: 'schedule',
  speakers: 'speakers',
  sponsors: 'sponsors',
  updates: 'updates',
});

/** Ceiling on a request path before it is even parsed. */
const MAX_ROUTE_PATH_LENGTH = 512;

/** Deeper than any route the app mounts or any page path the CMS accepts. */
const MAX_ROUTE_SEGMENTS = 6;

/**
 * A record id or slug this handler will look up. Anything else is not a
 * lookup miss, it is a request that never reaches Firestore: the Admin SDK
 * throws on an id shaped outside this, and an unbounded segment is an
 * unbounded query key.
 */
const ROUTE_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The route path a request names, normalized: no query, no fragment, no
 * repeated or trailing separators, each segment percent-decoded.
 *
 * Case is preserved. A `cmsSchedule` doc id may carry capitals, and a page
 * `path` is matched exactly against the stored value.
 *
 * @param {{ path?: string, url?: string }} req
 * @returns {string} `/` or `/a`, `/a/b`
 */
function requestedRoutePath(req) {
  const raw = typeof req?.path === 'string' && req.path
    ? req.path
    : (typeof req?.url === 'string' && req.url ? req.url : '/');
  const withoutQuery = raw.split('?')[0].split('#')[0].slice(0, MAX_ROUTE_PATH_LENGTH);
  const segments = withoutQuery
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      let decoded;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return segment;
      }
      // A `%2F` must not smuggle a second segment past the split above.
      return decoded.includes('/') ? segment : decoded;
    });
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

/**
 * What the route is about, read from live documents only.
 *
 * Visibility is checked STRICTLY (`=== true`) everywhere, for the reason
 * updatesMeta states: this runs on the Admin SDK, which bypasses
 * firestore.rules, so a document with the field merely absent must not
 * read as published.
 *
 * A detail route whose record does not resolve returns null rather than
 * falling back to its parent listing — a link to a speaker who has been
 * removed is not the speakers page, and describing it as one would put a
 * directory title under a person's URL.
 *
 * @param {{ db: FirebaseFirestore.Firestore, config: object, path: string }} args
 * @returns {Promise<{ kind: 'page'|'session'|'speaker', doc: object } | null>}
 */
async function resolveRouteSubject({ db, config, path }) {
  const segments = path === '/' ? [] : path.slice(1).split('/');
  const [first, second] = segments;
  const features = (config && config.features) || {};
  if (first && SEGMENT_FEATURES[first] && features[SEGMENT_FEATURES[first]] !== true) return null;
  if (segments.length > MAX_ROUTE_SEGMENTS) return null;

  // The two detail routes own their second segment outright: `schedule`
  // and `speakers` are reserved (shared/routing), so no page document can
  // sit under either prefix and there is nothing to fall through to.
  if (segments.length === 2 && (first === 'speakers' || first === 'schedule')) {
    if (!ROUTE_KEY_RE.test(second)) return null;
    if (first === 'speakers') {
      // `speakers_public` is the projection, and only an approved speaker
      // has one — presence IS publication (speakers/projection.cjs).
      const snap = await db.collection('speakers_public').where('slug', '==', second).limit(1).get();
      const doc = snap.docs[0];
      return doc ? { kind: 'speaker', doc: doc.data() } : null;
    }
    const snap = await db.collection('cmsSchedule').doc(second).get();
    const data = snap.exists ? snap.data() : null;
    return data && data.visible === true ? { kind: 'session', doc: data } : null;
  }

  // Everything else is matched against the page's own `path`, which is not
  // always one segment: `validatePageDoc` accepts a nested route such as
  // `/about/team`, and the catch-all renderer matches it the same way.
  const snap = await db.collection('cmsPages').where('path', '==', path).limit(1).get();
  const doc = snap.docs[0];
  const page = doc ? doc.data() : null;
  return page && page.visible === true ? { kind: 'page', doc: page } : null;
}

/**
 * A displayable URL for a `config/theme.logos` slot, resolved server-side.
 *
 * Mirrors `brandingSrc` in apps/web/src/lib/mediaSource.js: a FLAT
 * `branding/x.svg` is a seeded placeholder that ships in the bundle and
 * resolves against the site, while `branding/{assetId}/{name}` exists only
 * in the bucket. A value that is not a usable object path resolves to null
 * and no image tag is written at all.
 *
 * @param {unknown} value
 * @param {{ base: string, bucket: string|null }} args
 * @returns {string|null}
 */
function brandingObjectUrl(value, { base, bucket }) {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path.length === 0) return null;
  if (path.startsWith('/') || path.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (path.split('/').length > 2) {
    return isNonEmptyString(bucket)
      ? `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media`
      : null;
  }
  return `${base}/${path}`;
}

/**
 * The UTC offset in force for one event-local wall clock, as `+05:30` or
 * `-04:00`, or null when the zone or the wall clock cannot be resolved.
 *
 * Two passes, so a day on either side of a daylight-saving change carries
 * the offset actually in force on that day rather than the one in force
 * today. The same two-pass search apps/web's `zonedDateTime`
 * (apps/web/src/lib/eventTime.js) runs for the same reason; that module is
 * browser ESM and cannot be required here.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {string} time `HH:MM`
 * @param {string} timezone IANA zone name
 * @returns {string|null}
 */
function zoneOffset(date, time, timezone) {
  if (!isNonEmptyString(timezone)) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wallMs = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const wallClockAsUtcMs = (instant) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      }).formatToParts(instant).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});
      // Some ICU builds render midnight as "24" in hour12:false mode.
      const hour = parts.hour === '24' ? '00' : parts.hour;
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second);
    };
    const guess = wallMs - (wallClockAsUtcMs(new Date(wallMs)) - wallMs);
    const utcMs = wallMs - (wallClockAsUtcMs(new Date(guess)) - guess);
    // A wall clock inside a spring-forward gap names no instant at all.
    if (wallClockAsUtcMs(new Date(utcMs)) !== wallMs) return null;
    const offsetMinutes = Math.round((wallMs - utcMs) / 60000);
    const sign = offsetMinutes < 0 ? '-' : '+';
    const abs = Math.abs(offsetMinutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${sign}${hh}:${mm}`;
  } catch {
    return null;
  }
}

/**
 * One end of the event as schema.org wants it: `2026-10-14T09:00-04:00`
 * when the day states a time and the event names a resolvable timezone,
 * `2026-10-14T09:00` when the offset cannot be worked out, and the bare
 * `2026-10-14` when the day states no time at all.
 *
 * The offset is what makes the figure mean one instant rather than one of
 * 24. A reader in another country is exactly who reads this.
 */
function dayMoment(date, time, timezone) {
  if (!/^\d{2}:\d{2}$/.test(time || '')) return date;
  const offset = zoneOffset(date, time, timezone);
  return offset ? `${date}T${time}${offset}` : `${date}T${time}`;
}

/** Drop the keys whose value is not a non-empty string. */
function compactStrings(map) {
  return Object.fromEntries(Object.entries(map).filter(([, v]) => isNonEmptyString(v)));
}

/**
 * The schema.org Event block, built from `config/event` alone — the one
 * document that states what the event is, when it runs, and where.
 *
 * Every field is omitted rather than guessed: a deployment that has not
 * filled in its venue emits an Event with no `location`, which is a
 * smaller claim than a location built out of blanks. An event with no
 * name emits nothing at all.
 *
 * The block describes the event, not the page, so its `url` is the site
 * rather than the route it is served on.
 *
 * @param {{ event: object|null, url: string, imageUrl?: string|null }} args
 * @returns {object|null}
 */
function buildEventJsonLd({ event, url, imageUrl = null }) {
  if (!event || !isNonEmptyString(event.name)) return null;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name.trim(),
  };
  const description = isNonEmptyString(event?.seo?.description)
    ? event.seo.description.trim()
    : (isNonEmptyString(event?.tagline) ? event.tagline.trim() : '');
  if (description) data.description = description;
  if (isNonEmptyString(url)) data.url = url;

  const days = (Array.isArray(event.days) ? event.days : [])
    .filter((day) => day && isNonEmptyString(day.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (days.length > 0) {
    const zone = event.timezone;
    data.startDate = dayMoment(days[0].date, days[0].startTime, zone);
    data.endDate = dayMoment(days[days.length - 1].date, days[days.length - 1].endTime, zone);
  }

  const venue = (event.venue && typeof event.venue === 'object') ? event.venue : {};
  const address = compactStrings({
    streetAddress: [venue.addressLine1, venue.addressLine2].filter(isNonEmptyString).join(', '),
    addressLocality: venue.city,
    addressRegion: venue.region,
    postalCode: venue.postalCode,
    addressCountry: venue.country,
  });
  if (isNonEmptyString(venue.name) || Object.keys(address).length > 0) {
    data.location = { '@type': 'Place' };
    if (isNonEmptyString(venue.name)) data.location.name = venue.name.trim();
    if (Object.keys(address).length > 0) data.location.address = { '@type': 'PostalAddress', ...address };
  }

  const organizer = compactStrings({ name: event?.seo?.organizerName, url: event?.seo?.organizerUrl });
  if (organizer.name) data.organizer = { '@type': 'Organization', ...organizer };
  if (isNonEmptyString(imageUrl)) data.image = imageUrl;
  return data;
}

/**
 * JSON for a `<script type="application/ld+json">` body. `<`, `>`, and `&`
 * become their JSON unicode escapes, which parse identically and cannot
 * close the script element they sit in.
 *
 * @param {object} data
 * @returns {string}
 */
function jsonLdPayload(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** The name a speaker projection displays under, or ''. */
function speakerName(speaker) {
  if (isNonEmptyString(speaker?.displayName)) return speaker.displayName.trim();
  return [speaker?.firstName, speaker?.lastName].filter(isNonEmptyString).join(' ').trim();
}

/**
 * The tags one route gets.
 *
 * A route this function cannot name — no page document, a hidden one, a
 * feature that is off, a detail record that does not resolve — gets the
 * event-level shell AND `noindex`: Hosting answers 200 for it while the
 * app renders a not-found, and a soft 404 is exactly the kind of URL that
 * should not enter an index. It claims no canonical either, because there
 * is no page for it to be the canonical of.
 *
 * `degraded` is the one case that looks like a miss and is not: the lookup
 * itself failed. That route keeps the plain shell but is NOT marked
 * noindex — a Firestore outage must not deindex a site.
 *
 * @param {{ config: object, subject: object|null, path: string, base: string,
 *           degraded?: boolean }} args
 */
function resolveRouteMeta({ config, subject, path, base, degraded = false }) {
  const event = (config && config.event) || null;
  const siteName = isNonEmptyString(event?.name) ? event.name.trim() : 'Event site';
  const eventDescription = isNonEmptyString(event?.seo?.description)
    ? event.seo.description.trim()
    : (isNonEmptyString(event?.tagline) ? event.tagline.trim() : '');
  const imageUrl = brandingObjectUrl(
    isNonEmptyString(config?.theme?.logos?.ogDefault)
      ? config.theme.logos.ogDefault
      : event?.seo?.defaultOgImagePath,
    { base, bucket: config?.tierA?.storageBucket || null },
  );
  const url = `${base}${path}`;
  const shell = {
    title: siteName,
    description: eventDescription,
    url: null,
    siteName,
    imageUrl,
    ogType: 'website',
    noindex: !degraded,
    jsonLd: null,
  };
  if (!subject) return shell;

  const titled = (name) => (isNonEmptyString(name) ? `${name.trim()} · ${siteName}` : siteName);
  const described = { ...shell, url, noindex: false, jsonLd: buildEventJsonLd({ event, url: base, imageUrl }) };

  if (subject.kind === 'session') {
    return {
      ...described,
      title: titled(subject.doc.title),
      description: excerpt(subject.doc.description) || eventDescription,
      ogType: 'article',
    };
  }
  if (subject.kind === 'speaker') {
    const name = speakerName(subject.doc);
    if (!name) return shell;
    const role = [subject.doc.jobTitle, subject.doc.organization].filter(isNonEmptyString).join(', ');
    return {
      ...described,
      title: titled(name),
      description: excerpt(subject.doc.bio) || role || eventDescription,
      ogType: 'profile',
    };
  }
  // A page. The home page is titled with the event alone: its label names
  // the document for an editor, not the site for a reader.
  return { ...described, title: path === '/' ? siteName : titled(subject.doc.label) };
}

/**
 * Inject one route's tags into the self-fetched template.
 *
 * Every interpolated value is {@link escapeHtml}-escaped, and both
 * replacements use a replacer FUNCTION, so a dollar-sign replacement
 * pattern in a title is inserted literally rather than read as one.
 *
 * @param {{ template: string, meta: object }} args
 * @returns {string}
 */
function buildRouteHtml({ template, meta }) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const siteName = escapeHtml(meta.siteName);
  const url = isNonEmptyString(meta.url) ? escapeHtml(meta.url) : null;
  const image = isNonEmptyString(meta.imageUrl) ? escapeHtml(meta.imageUrl) : null;

  const tags = [];
  if (description) tags.push(`<meta name="description" content="${description}">`);
  if (meta.noindex) tags.push('<meta name="robots" content="noindex">');
  if (url) tags.push(`<link rel="canonical" href="${url}">`);
  tags.push(`<meta property="og:title" content="${title}">`);
  if (description) tags.push(`<meta property="og:description" content="${description}">`);
  if (url) tags.push(`<meta property="og:url" content="${url}">`);
  tags.push(`<meta property="og:site_name" content="${siteName}">`);
  tags.push(`<meta property="og:type" content="${escapeHtml(meta.ogType || 'website')}">`);
  if (image) tags.push(`<meta property="og:image" content="${image}">`);
  tags.push(`<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`);
  tags.push(`<meta name="twitter:title" content="${title}">`);
  if (description) tags.push(`<meta name="twitter:description" content="${description}">`);
  if (image) tags.push(`<meta name="twitter:image" content="${image}">`);
  if (meta.jsonLd) tags.push(`<script type="application/ld+json">${jsonLdPayload(meta.jsonLd)}</script>`);
  const block = tags.join('\n    ');

  const html = TITLE_RE.test(template)
    ? template.replace(TITLE_RE, () => `<title>${title}</title>`)
    : template;
  return HEAD_CLOSE_RE.test(html)
    ? html.replace(HEAD_CLOSE_RE, () => `    ${block}\n  </head>`)
    : `${html}\n${block}`;
}

/**
 * @param {{ db: FirebaseFirestore.Firestore, getConfig: () => Promise<object>,
 *           fetchTemplateFn?: typeof fetchTemplate, now?: () => number,
 *           log?: Pick<Console, 'error'> }} deps
 */
function createRouteMetaHandler({
  db,
  getConfig,
  fetchTemplateFn = fetchTemplate,
  lastTemplateFn = lastKnownTemplate,
  now = Date.now,
  log = console,
}) {
  return async function routeMeta(req, res) {
    // HEAD is answered as GET (Express drops the body itself). This
    // function fronts every public route, and link checkers and uptime
    // probes ask for pages with HEAD — before this rewrite existed they
    // were reading a static file, which answers HEAD without comment.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return methodNotAllowed(res, ['GET', 'HEAD']);
    }

    try {
      // Each of the three reads below can fail on its own, and none of
      // them is worth a 5xx for the whole site: the shell alone still
      // boots the app, which fetches its own configuration. `degraded`
      // records that a route WOULD have had tags, so it is not marked
      // noindex the way a route that genuinely does not exist is.
      let config = null;
      let degraded = false;
      try {
        config = await getConfig();
      } catch (err) {
        degraded = true;
        log.error('routeMeta could not read the configuration', err);
      }

      const publicUrl = config?.tierA?.publicUrl;
      const base = isNonEmptyString(publicUrl) ? publicUrl.replace(/\/+$/, '') : '';
      let template = null;
      if (isNonEmptyString(publicUrl)) {
        try {
          template = await fetchTemplateFn({ publicUrl, now });
        } catch (err) {
          log.error('routeMeta could not fetch the template', err);
        }
      } else if (!degraded) {
        degraded = true;
        log.error('routeMeta has no configured public URL');
      }
      // Whatever this container last held, including across a failed
      // config read that left no URL to fetch with.
      if (!template) template = lastTemplateFn();
      if (!template) {
        // Nothing has ever been fetched, so there is no HTML to serve and
        // no honest way to invent it.
        return internal(res, 'The page could not be served.');
      }

      const path = requestedRoutePath(req);
      let subject = null;
      if (config && base) {
        try {
          subject = await resolveRouteSubject({ db, config, path });
        } catch (err) {
          degraded = true;
          log.error('routeMeta could not resolve the route', err);
        }
      }

      const meta = resolveRouteMeta({ config, subject, path, base, degraded });
      res.status(200);
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', ROUTE_CACHE_CONTROL);
      res.send(buildRouteHtml({ template, meta }));
    } catch (err) {
      log.error('routeMeta failed', err);
      internal(res, 'The page could not be served.');
    }
  };
}

/** Deployable exports: updatesMeta and routeMeta (public GET, spec §9). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, getConfig: () => getEventConfig({ db }) };
  };

  const withCors = (handler, methods = ['GET']) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods,
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    updatesMeta: onRequest({ region }, withCors(async (req, res) => {
      await createUpdatesMetaHandler(buildDeps())(req, res);
    })),
    routeMeta: onRequest({ region }, withCors(async (req, res) => {
      await createRouteMetaHandler(buildDeps())(req, res);
    }, ['GET', 'HEAD'])),
  };
}

module.exports = {
  createUpdatesMetaHandler,
  createRouteMetaHandler,
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
    lastKnownTemplate,
    TEMPLATE_REVALIDATE_FLOOR_MS,
    requestedRoutePath,
    resolveRouteSubject,
    resolveRouteMeta,
    buildRouteHtml,
    buildEventJsonLd,
    brandingObjectUrl,
    zoneOffset,
    ROUTE_CACHE_CONTROL,
  },
};
