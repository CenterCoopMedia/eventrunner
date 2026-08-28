'use strict';

const { evaluateReadiness, allReady } = require('shared/readiness');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, methodNotAllowed, internal } = require('../core/errors.cjs');
const { validatePageDoc, internals: pageInternals } = require('../cms/pages.cjs');
const { scanUsage } = require('../media/usage.cjs');
const { readTicketingStatus } = require('../ticketing/index.cjs');

const PAGE_ISSUE_LIMIT = 20;
const PUBLISH_QUEUE_LIMIT = 10;
const SYSTEM_ERROR_LIMIT = 20;
const MEDIA_ASSET_LIMIT = 50;
const SAFE_KIND_RE = /^[a-z0-9-]{1,80}$/;
const SENSITIVE_KEY_PARTS = Object.freeze([
  'email',
  'token',
  'secret',
  'password',
  'credential',
  'authorization',
  'attendee',
  'ticket',
  'payment',
  'invitation',
  'storage',
  'path',
  'url',
  'userid',
  'uid',
  'requestedby',
  'resolvedby',
  'webhookid',
  'externaleventid',
]);

class DiagnosticError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizedKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveKey(key) {
  const normalized = normalizedKey(key);
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function redactDiagnosticValue(value) {
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, entry]) => [key, redactDiagnosticValue(entry)]),
  );
}

function bounded(items, limit) {
  return {
    items: items.slice(0, limit),
    total: items.length,
    truncated: Math.max(0, items.length - limit),
  };
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIso(value) {
  const millis = toMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

function assertOnlyKeys(body, allowed) {
  const unknown = Object.keys(body || {}).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new DiagnosticError(400, 'invalid-input', 'The diagnostic input is not valid.');
  }
}

function createDiagnosticHandler({ auth, getConfig, log = console }, read) {
  return async function diagnostic(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    try {
      const result = await read(req.body || {});
      return res.status(200).json(redactDiagnosticValue(result));
    } catch (error) {
      if (error instanceof DiagnosticError) {
        return sendError(res, error.status, error.code, error.message);
      }
      log.error('WebMCP diagnostic failed', error);
      return internal(res, 'The diagnostic is temporarily unavailable.');
    }
  };
}

async function readEventReadiness({ db, getConfig }) {
  const [config, seeded] = await Promise.all([
    getConfig(),
    db.collection('cmsContent').where('seeded', '==', true).get(),
  ]);
  const rows = evaluateReadiness({
    event: config.event,
    providers: config.providers,
    theme: config.theme,
    bootstrap: config.bootstrap,
    seededContentCount: seeded.size ?? seeded.docs.length,
  });
  return {
    ready: allReady(rows),
    checks: bounded(
      rows.map((row) => ({
        name: row.id,
        label: row.label,
        state: row.ok ? 'ready' : 'action-required',
      })),
      rows.length,
    ),
  };
}

async function readCurrentPageDraft({ db }, body) {
  assertOnlyKeys(body, ['pageId']);
  if (typeof body.pageId !== 'string' || !pageInternals.DOC_ID_RE.test(body.pageId)) {
    throw new DiagnosticError(400, 'invalid-input', 'Open a page editor before you run this diagnostic.');
  }
  const snapshot = await db.collection('cmsPages_drafts').doc(body.pageId).get();
  if (!snapshot.exists) {
    throw new DiagnosticError(409, 'unavailable-diagnostic', 'The current page has no draft to validate.');
  }
  const verdict = validatePageDoc({ id: body.pageId, ...snapshot.data() });
  return {
    valid: verdict.ok,
    issues: bounded(
      verdict.errors.map((issue) => String(issue).slice(0, 240)),
      PAGE_ISSUE_LIMIT,
    ),
  };
}

function publishRow(doc) {
  const data = doc.data() || {};
  const request = data.request && typeof data.request === 'object' ? data.request : {};
  const progress = data.progress && typeof data.progress === 'object' ? data.progress : {};
  return {
    state: ['running', 'done', 'failed'].includes(data.status) ? data.status : 'unknown',
    requestedAt: toIso(data.requestedAt),
    updatedAt: toIso(data.updatedAt),
    finishedAt: toIso(data.finishedAt),
    collectionCount: Object.keys(request).length,
    documentCount: Object.values(request).reduce(
      (total, ids) => total + (Array.isArray(ids) ? ids.length : 0),
      0,
    ),
    publishedCount: Object.values(progress).reduce(
      (total, item) => total + (Number.isInteger(item?.published) ? item.published : 0),
      0,
    ),
  };
}

async function readPublishQueue({ db }) {
  const snapshot = await db.collection('cmsPublishQueue').get();
  const rows = snapshot.docs
    .slice()
    .sort((a, b) => (toMillis(b.data()?.requestedAt) ?? 0) - (toMillis(a.data()?.requestedAt) ?? 0))
    .map(publishRow);
  return { rows: bounded(rows, PUBLISH_QUEUE_LIMIT) };
}

async function readSystemErrors({ db }) {
  const snapshot = await db.collection('system_errors').where('resolved', '==', false).get();
  const rows = snapshot.docs
    .slice()
    .sort((a, b) => (toMillis(b.data()?.createdAt) ?? 0) - (toMillis(a.data()?.createdAt) ?? 0))
    .map((doc) => {
      const data = doc.data() || {};
      return {
        kind: SAFE_KIND_RE.test(data.kind || '') ? data.kind : 'unknown',
        createdAt: toIso(data.createdAt),
        lastSeenAt: toIso(data.lastSeenAt),
        state: 'open',
      };
    });
  return { rows: bounded(rows, SYSTEM_ERROR_LIMIT) };
}

async function readMediaUsage({ db }) {
  const snapshot = await db.collection('media_assets').get();
  const assets = snapshot.docs
    .map((doc) => doc.data() || {})
    .filter((asset) => typeof asset.path === 'string' && asset.path.length > 0);
  const checked = assets.slice(0, MEDIA_ASSET_LIMIT);
  const paths = [...new Set(checked.map((asset) => asset.path))];
  const usage = await scanUsage({ db, paths });
  const referenceCounts = paths.map((path) => usage[path]?.length ?? 0);
  return {
    assets: {
      checked: checked.length,
      total: snapshot.docs.length,
      truncated: Math.max(0, assets.length - checked.length),
      referenced: referenceCounts.filter((count) => count > 0).length,
      unused: referenceCounts.filter((count) => count === 0).length,
      references: referenceCounts.reduce((total, count) => total + count, 0),
      missingIndexData: snapshot.docs.length - assets.length,
    },
  };
}

async function readTicketingHealth({ db, provider, getConfig, now }) {
  const status = await readTicketingStatus({ db, provider, getConfig, now });
  return {
    integration: typeof status.provider === 'string' ? status.provider : 'unknown',
    webhookSupported: status.webhookSupported === true,
    webhookConfigured: Boolean(status.webhookRegisteredAt),
    lastDeliveryAt: toIso(status.lastDeliveryAt),
    queue: {
      pending: Number.isInteger(status.queue?.pending) ? status.queue.pending : 0,
      pendingCapped: status.queue?.pendingCapped === true,
      exhausted: Number.isInteger(status.queue?.exhausted) ? status.queue.exhausted : 0,
      exhaustedCapped: status.queue?.exhaustedCapped === true,
      oldestReadyAt: toIso(status.queue?.oldestReadyAt),
    },
    checkedAt: toIso(status.checkedAt),
  };
}

function createCheckEventReadinessHandler(deps) {
  return createDiagnosticHandler(deps, (body) => {
    assertOnlyKeys(body, []);
    return readEventReadiness(deps);
  });
}

function createValidateCurrentPageDraftHandler(deps) {
  return createDiagnosticHandler(deps, (body) => readCurrentPageDraft(deps, body));
}

function createInspectPublishQueueHandler(deps) {
  return createDiagnosticHandler(deps, (body) => {
    assertOnlyKeys(body, []);
    return readPublishQueue(deps);
  });
}

function createInspectSystemErrorsHandler(deps) {
  return createDiagnosticHandler(deps, (body) => {
    assertOnlyKeys(body, []);
    return readSystemErrors(deps);
  });
}

function createCheckMediaUsageHandler(deps) {
  return createDiagnosticHandler(deps, (body) => {
    assertOnlyKeys(body, []);
    return readMediaUsage(deps);
  });
}

function createCheckTicketingHealthHandler(deps) {
  return createDiagnosticHandler(deps, (body) => {
    assertOnlyKeys(body, []);
    return readTicketingHealth(deps);
  });
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { getDb } = require('../core/firestore.cjs');
  const { getAuth } = require('firebase-admin/auth');
  const { getEventConfig } = require('../core/config.cjs');
  const { getTicketingProvider, ticketingSecretNames } = require('../ticketing/index.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const db = getDb();
    return {
      db,
      auth: getAuth(),
      getConfig: () => getEventConfig({ db }),
      now: () => new Date(),
      log: console,
    };
  };
  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (!handled) await handler(req, res);
  };
  const expose = (create, options = {}) =>
    onRequest({ region, ...options }, withCors(async (req, res) => {
      await create(buildDeps())(req, res);
    }));

  const ticketingSecrets = ticketingSecretNames(process.env).map(defineSecret);
  return {
    webMcpCheckEventReadiness: expose(createCheckEventReadinessHandler),
    webMcpValidateCurrentPageDraft: expose(createValidateCurrentPageDraftHandler),
    webMcpInspectPublishQueue: expose(createInspectPublishQueueHandler),
    webMcpInspectSystemErrors: expose(createInspectSystemErrorsHandler),
    webMcpCheckMediaUsage: expose(createCheckMediaUsageHandler),
    webMcpCheckTicketingHealth: onRequest(
      { region, secrets: ticketingSecrets },
      withCors(async (req, res) => {
        const deps = buildDeps();
        deps.provider = getTicketingProvider({
          env: process.env,
          db: deps.db,
          getConfig: deps.getConfig,
        });
        await createCheckTicketingHealthHandler(deps)(req, res);
      }),
    ),
  };
}

module.exports = {
  createCheckEventReadinessHandler,
  createValidateCurrentPageDraftHandler,
  createInspectPublishQueueHandler,
  createInspectSystemErrorsHandler,
  createCheckMediaUsageHandler,
  createCheckTicketingHealthHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    DiagnosticError,
    redactDiagnosticValue,
    bounded,
    readEventReadiness,
    readCurrentPageDraft,
    readPublishQueue,
    readSystemErrors,
    readMediaUsage,
    readTicketingHealth,
    PUBLISH_QUEUE_LIMIT,
    SYSTEM_ERROR_LIMIT,
    MEDIA_ASSET_LIMIT,
  },
};
