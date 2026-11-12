'use strict';

const {
  FEATURE_KEY,
  COLLECTION,
  RETENTION_DAYS,
  MAX_BODY_BYTES,
  validSample,
  bucketFor,
} = require('shared/webVitals');

const FLUSH_INTERVAL_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLIC_OPTIONS = Object.freeze({ maxInstances: 1, concurrency: 80, cpu: 1 });

/** @param {object} req @returns {number} */
function requestBytes(req) {
  if (Buffer.isBuffer(req?.rawBody)) return req.rawBody.length;
  if (typeof req?.rawBody === 'string') return Buffer.byteLength(req.rawBody, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(req?.body ?? {}), 'utf8');
  } catch {
    return MAX_BODY_BYTES + 1;
  }
}

/** @param {object} req @returns {unknown} */
function requestBody(req) {
  if (req?.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const text = typeof req?.body === 'string'
    ? req.body
    : Buffer.isBuffer(req?.rawBody) ? req.rawBody.toString('utf8') : null;
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Categorical route values make this reversible encoding safe for a doc id. */
function aggregateId(day, route, device) {
  return `${day}__${device}__${Buffer.from(route, 'utf8').toString('base64url')}`;
}

function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function expiryForDay(day) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + RETENTION_DAYS * DAY_MS);
}

/** @param {object} db @returns {Promise<boolean>} */
async function featureEnabled(db) {
  try {
    const snapshot = await db.collection('config').doc('features').get();
    return snapshot.exists === true && snapshot.data()?.[FEATURE_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Coalesce validated samples into one atomic increment patch per day, route,
 * and device. The object contains no request or browser identifiers.
 */
function aggregateSamples(samples, nowMs, increment) {
  const day = utcDay(nowMs);
  const groups = new Map();
  for (const sample of samples) {
    const id = aggregateId(day, sample.route, sample.device);
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        data: {
          day,
          route: sample.route,
          device: sample.device,
          counts: {},
          expiresAt: expiryForDay(day),
        },
      });
    }
    const counts = groups.get(id).data.counts;
    counts[sample.name] ||= {};
    const bucket = bucketFor(sample.name, sample.value);
    counts[sample.name][bucket] = (counts[sample.name][bucket] || 0) + 1;
  }
  for (const { data } of groups.values()) {
    for (const buckets of Object.values(data.counts)) {
      for (const [bucket, count] of Object.entries(buckets)) buckets[bucket] = increment(count);
    }
  }
  return [...groups.values()];
}

/**
 * One recorder exists per function instance. The deployment has one instance,
 * so function concurrency is also the bound on pending samples.
 */
function createVitalsRecorder({
  db,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  increment = (amount) => require('firebase-admin/firestore').FieldValue.increment(amount),
  flushIntervalMs = FLUSH_INTERVAL_MS,
}) {
  let pending = [];
  let draining = false;

  async function writeWindow(entries) {
    if (!(await featureEnabled(db))) return { stored: false };
    const groups = aggregateSamples(entries.map(({ sample }) => sample), now(), increment);
    const batch = db.batch();
    for (const { id, data } of groups) {
      batch.set(db.collection(COLLECTION).doc(id), data, { merge: true });
    }
    await batch.commit();
    return { stored: true };
  }

  async function drain() {
    while (pending.length > 0) {
      await wait(flushIntervalMs);
      const entries = pending;
      pending = [];
      try {
        const result = await writeWindow(entries);
        for (const entry of entries) entry.resolve(result);
      } catch (error) {
        for (const entry of entries) entry.reject(error);
      }
    }
    draining = false;
  }

  return {
    record(sample) {
      return new Promise((resolve, reject) => {
        pending.push({ sample, resolve, reject });
        if (!draining) {
          draining = true;
          void drain();
        }
      });
    },
  };
}

function createWebVitalsHandler({ recorder }) {
  return async function collectWebVitals(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      res.status(405).json({ error: { code: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }
    if (requestBytes(req) > MAX_BODY_BYTES) {
      res.status(413).json({ error: { code: 'payload-too-large', message: 'The sample is too large.' } });
      return;
    }
    const sample = requestBody(req);
    if (!validSample(sample)) {
      res.status(400).json({ error: { code: 'bad-request', message: 'The sample is invalid.' } });
      return;
    }
    try {
      await recorder.record(sample);
      res.status(204).send('');
    } catch {
      res.status(503).json({ error: { code: 'temporarily-unavailable', message: 'The sample could not be stored.' } });
    }
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  let recorder;

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods: ['POST'],
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    logWebVitals: onRequest({ region, ...PUBLIC_OPTIONS }, withCors(async (req, res) => {
      if (!recorder) {
        const { getDb } = require('../core/firestore.cjs');
        recorder = createVitalsRecorder({ db: getDb() });
      }
      await createWebVitalsHandler({ recorder })(req, res);
    })),
  };
}

module.exports = {
  createVitalsRecorder,
  createWebVitalsHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    requestBytes,
    requestBody,
    aggregateId,
    utcDay,
    expiryForDay,
    featureEnabled,
    aggregateSamples,
    FLUSH_INTERVAL_MS,
    PUBLIC_OPTIONS,
  },
};
