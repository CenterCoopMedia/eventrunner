'use strict';

// Approved telemetry categories, never user-supplied paths. The route
// contract test compares these with the production application's registry.
const ROUTE_PATTERNS = Object.freeze([
  '/', '/schedule', '/schedule/mine', '/schedule/user/:uid', '/schedule/:sessionId',
  '/speakers', '/speakers/:slug', '/sponsors', '/sponsors/:slug', '/updates', '/updates/:id',
  '/pitch/:stepSlug?', '/signin', '/speaker/accept', '/speaker/profile/:stepSlug?',
  '/speaker/dashboard', '/ticket/claim', '/tickets', '/tickets/status', '/tickets/mine',
  '/registration/:stepSlug?', '/profile', '/profile/change-requests', '/profile/organization',
  '/dashboard', '/attendees', '/attendees/:uid', '/attendees/posts/:postId', '/admin/*', '/*',
]);

const METRICS = Object.freeze({
  LCP: { width: 100, maximum: 60000, good: 2500, poor: 4000, unit: 'ms' },
  INP: { width: 10, maximum: 10000, good: 200, poor: 500, unit: 'ms' },
  CLS: { width: 0.01, maximum: 5, good: 0.1, poor: 0.25, unit: '' },
  LCP_TTFB: { width: 100, maximum: 60000, unit: 'ms' },
  LCP_RESOURCE_DELAY: { width: 100, maximum: 60000, unit: 'ms' },
  LCP_RESOURCE_DURATION: { width: 100, maximum: 60000, unit: 'ms' },
  LCP_RENDER_DELAY: { width: 100, maximum: 60000, unit: 'ms' },
  held_up: { width: 1, maximum: 1, unit: '' },
});

const FEATURE_KEY = 'coreWebVitals';
const COLLECTION = 'web_vitals_daily';
const RETENTION_DAYS = 30;
const MAX_BODY_BYTES = 512;
const SAMPLE_KEYS = ['device', 'name', 'route', 'value'];

/** Reject unknown fields rather than discarding possible identifiers. */
function validSample(sample) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return false;
  const keys = Object.keys(sample).sort();
  return keys.length === SAMPLE_KEYS.length && keys.every((key, index) => key === SAMPLE_KEYS[index])
    && ROUTE_PATTERNS.includes(sample.route)
    && ['mobile', 'desktop'].includes(sample.device)
    && Object.hasOwn(METRICS, sample.name)
    && typeof sample.value === 'number' && Number.isFinite(sample.value) && sample.value >= 0
    && (sample.name !== 'held_up' || sample.value === 1);
}

/** Zero is exact; other buckets name their upper bound, with one tail. */
function bucketFor(name, value) {
  const { width, maximum } = METRICS[name];
  if (value > maximum) return String(Math.round(maximum / width) + 1);
  const scaled = value / width;
  return String(Math.ceil(scaled - Number.EPSILON * scaled));
}

function bucketUpperBound(name, bucket) {
  const { width, maximum } = METRICS[name];
  return Number(bucket) > Math.round(maximum / width) ? Infinity : Number(bucket) * width;
}

function addBuckets(target, name, buckets) {
  const maximumBucket = Math.round(METRICS[name].maximum / METRICS[name].width) + 1;
  for (const [bucket, count] of Object.entries(buckets)) {
    if (!/^(0|[1-9]\d*)$/.test(bucket) || Number(bucket) > maximumBucket || !Number.isSafeInteger(count) || count <= 0) continue;
    target.set(bucket, (target.get(bucket) || 0) + count);
  }
}

function summarizeGroup({ route, device, name, buckets }) {
  const count = [...buckets.values()].reduce((sum, value) => sum + value, 0);
  let remaining = Math.ceil(count * 0.75);
  let p75 = null;
  for (const [bucket, samples] of [...buckets].sort(([a], [b]) => Number(a) - Number(b))) {
    remaining -= samples;
    if (remaining <= 0) { p75 = bucketUpperBound(name, bucket); break; }
  }
  const { good, poor } = METRICS[name];
  let rating = null;
  if (p75 !== null && good !== undefined) {
    rating = p75 <= good ? 'good' : p75 <= poor ? 'needs improvement' : 'poor';
  }
  return { route, device, name, count, p75: name === 'held_up' ? null : p75, rating };
}

/** Counts are daily aggregates. No observation or navigation ID is needed. */
function summarizeVitals(records) {
  const groups = new Map();
  for (const record of records) {
    if (!ROUTE_PATTERNS.includes(record?.route) || !['mobile', 'desktop'].includes(record?.device)) continue;
    for (const [name, buckets] of Object.entries(record.counts || {})) {
      if (!Object.hasOwn(METRICS, name) || !buckets || typeof buckets !== 'object' || Array.isArray(buckets)) continue;
      const key = JSON.stringify([record.route, record.device, name]);
      if (!groups.has(key)) groups.set(key, { route: record.route, device: record.device, name, buckets: new Map() });
      addBuckets(groups.get(key).buckets, name, buckets);
    }
  }
  return [...groups.values()].map(summarizeGroup).filter(({ count }) => count > 0)
    .sort((a, b) => a.route.localeCompare(b.route) || a.device.localeCompare(b.device) || a.name.localeCompare(b.name));
}

module.exports = { ROUTE_PATTERNS, METRICS, FEATURE_KEY, COLLECTION, RETENTION_DAYS, MAX_BODY_BYTES,
  validSample, bucketFor, bucketUpperBound, summarizeVitals };
