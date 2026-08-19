'use strict';

/**
 * Config loader for the functions runtime (spec §2.4).
 *
 * One in-memory cache per container, 5-minute TTL, seeded from Tier A env
 * for the handful of fields that exist there. Handlers await
 * getEventConfig(); nothing reads config at module scope, because a
 * module-scope read runs at deploy analysis time when Firestore is not
 * reachable.
 *
 * Tier A wins on conflict (spec §2.2): the Tier B `providers` copy exists
 * only so the admin UI can display it read-only.
 */

const CONFIG_DOC_IDS = ['event', 'features', 'theme', 'badges', 'providers', 'bootstrap'];
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Structured view of the Tier A env the functions runtime consumes
 * (spec §2.1). Frontend-only VITE_* keys are deliberately not read here.
 *
 * @param {Record<string, string|undefined>} [env]
 */
function getTierA(env = process.env) {
  const get = (key) => {
    const v = env[key];
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  };
  return {
    slug: get('EVENT_SLUG'),
    projectId: get('EVENT_FIREBASE_PROJECT_ID'),
    region: get('EVENT_FIREBASE_REGION') || 'us-central1',
    publicUrl: get('EVENT_PUBLIC_URL'),
    storageBucket: get('EVENT_STORAGE_BUCKET'),
    allowedOrigins: (get('EVENT_ALLOWED_ORIGINS') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    emailProvider: get('EVENT_EMAIL_PROVIDER'),
    ticketingProvider: get('EVENT_TICKETING_PROVIDER'),
    ticketingEventId: get('EVENT_TICKETING_EVENT_ID'),
    operatorNotifier: get('EVENT_OPERATOR_NOTIFIER'),
  };
}

let cache = null; // { loadedAt, value }

/**
 * Load the Tier B config docs, cached per container.
 *
 * @param {{ db: FirebaseFirestore.Firestore, env?: Record<string, string|undefined>,
 *           now?: () => number, forceRefresh?: boolean }} deps
 * @returns {Promise<{ event: object|null, features: object, theme: object|null,
 *   badges: object|null, providers: object|null, bootstrap: object|null,
 *   tierA: ReturnType<typeof getTierA> }>}
 *   Missing docs load as null (features as {}) — a handler that requires a
 *   seeded doc checks and fails itself; a half-seeded deployment must not
 *   crash every function in the container.
 */
async function getEventConfig({ db, env = process.env, now = Date.now, forceRefresh = false }) {
  if (!forceRefresh && cache && now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.value;
  }
  const refs = CONFIG_DOC_IDS.map((id) => db.collection('config').doc(id));
  const snaps = await db.getAll(...refs);
  const docs = {};
  CONFIG_DOC_IDS.forEach((id, i) => {
    docs[id] = snaps[i].exists ? snaps[i].data() : null;
  });
  const value = {
    event: docs.event,
    features: docs.features || {},
    theme: docs.theme,
    badges: docs.badges,
    providers: docs.providers,
    bootstrap: docs.bootstrap,
    tierA: getTierA(env),
  };
  cache = { loadedAt: now(), value };
  return value;
}

/** Test hook: drop the container cache. */
function resetConfigCacheForTest() {
  cache = null;
}

module.exports = {
  getEventConfig,
  getTierA,
  internals: { resetConfigCacheForTest, CACHE_TTL_MS, CONFIG_DOC_IDS },
};
