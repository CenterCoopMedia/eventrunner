'use strict';

/**
 * `webAddress`: the custom web address, an optional upgrade (ADR 0007 §8,
 * slice P9a). Operator tier, POST `{ action }`:
 *
 *   status          → the stored address and its state
 *   add { domain }  → ask Firebase Hosting for the domain; answer the records to add
 *   check           → read Hosting's state now ("Check now")
 *   remove          → ask Hosting to drop the domain; forget it
 *
 * STATES. `none` → `records` (the client adds the records; checks run) →
 * `switch` (Hosting serves the domain with a certificate, and the domain is
 * an authorized sign-in domain; the site's public address still has to
 * change by a deploy) → `done` (EVENT_PUBLIC_URL is the domain).
 *
 * The switch is a deploy because EVENT_PUBLIC_URL is a deploy-time value.
 * Until the console's GitHub App exists (P8), the hosting team runs it.
 *
 * The record lives in `web_address/current`, which no client reads or
 * writes (firestore.rules). Hosting and the sign-in settings are reached
 * through injected clients; the real ones call Google's APIs for this
 * project with the functions' own identity, and tests use fakes, so CI
 * stays credential-free. Provider error text never reaches the page.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { sendError, methodNotAllowed } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');

const COLLECTION = 'web_address';
const DOC = 'current';
const HOSTING_API = 'https://firebasehosting.googleapis.com/v1beta1';
const IDENTITY_API = 'https://identitytoolkit.googleapis.com/admin/v2';
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Addresses the site already has, or that belong to the platform.
const RESERVED_SUFFIXES = Object.freeze(['.web.app', '.firebaseapp.com', '.eventrunner.org']);
const WAITING = 'records';

class WebAddressError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new WebAddressError(status, code, message); };
const UNAVAILABLE = 'The web address service did not answer. Try again in a few minutes.';

/** A plain domain in lowercase, or null. No scheme, path, port or trailing dot. */
function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const domain = value.trim().toLowerCase().replace(/\.$/, '');
  if (domain.length > 253 || /[^a-z0-9.-]/.test(domain)) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (RESERVED_SUFFIXES.some((suffix) => domain.endsWith(suffix))) return null;
  return domain;
}

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : null;
}

function publicOrigin(env) {
  try { return new URL(env.EVENT_PUBLIC_URL).origin; } catch { return null; }
}

function view(record, env) {
  return {
    domain: record?.domain ?? null,
    state: record?.state ?? 'none',
    records: record?.state === WAITING ? record.records ?? [] : [],
    currentAddress: publicOrigin(env),
    lastCheckedAt: iso(record?.lastCheckedAt),
  };
}

/**
 * Read Hosting's state for the stored domain and move the record on. Live
 * means Hosting serves the domain with a certificate; the domain is then
 * added to the sign-in authorized domains before the state says so.
 */
async function checkRecord({ db, hosting, identity, env, now, record }) {
  const at = now();
  const read = await hosting.readDomain(record.domain);
  const next = { ...record, lastCheckedAt: at, updatedAt: at };
  if (!read.live) {
    next.state = WAITING;
    next.records = read.records;
  } else {
    await identity.addAuthorizedDomain(record.domain);
    next.state = publicOrigin(env) === `https://${record.domain}` ? 'done' : 'switch';
    next.records = [];
    next.liveAt = record.liveAt ?? at;
  }
  // The Hosting read can take a while. Write only if the record is still the
  // one this check started from, so a removal or a new domain in the
  // meantime wins over a stale check.
  const ref = db.collection(COLLECTION).doc(DOC);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.data().domain !== record.domain) return current.exists ? current.data() : null;
    tx.set(ref, next);
    return next;
  });
}

/** The scheduled check: only while a domain waits for its records. */
async function runWebAddressCheck({ db, hosting, identity, env = process.env, now = () => new Date() }) {
  const snap = await db.collection(COLLECTION).doc(DOC).get();
  const record = snap.exists ? snap.data() : null;
  if (!record || !['records', 'switch'].includes(record.state)) return { checked: false };
  // A read-only historical demo changes nothing, sign-in settings included.
  const policy = await checkDemoWrites({ db });
  if (!policy.ok) return { checked: false };
  await checkRecord({ db, hosting, identity, env, now, record });
  return { checked: true };
}

async function act({ db, hosting, identity, env, now, body, actor, log }) {
  const ref = db.collection(COLLECTION).doc(DOC);
  const snap = await ref.get();
  const record = snap.exists ? snap.data() : null;
  const audit = (action, details) => logAdminAction({ db, action: `webAddress.${action}`, docPath: `${COLLECTION}/${DOC}`, actor, now, details, log });

  if (body.action === 'status') return view(record, env);
  if (body.action === 'add') {
    const domain = normalizeDomain(body.domain);
    if (!domain) fail(400, 'bad-request', 'Enter a domain such as summit.example.org, with no https:// and no path.');
    if (record) fail(409, 'conflict', `The site already has ${record.domain} on the way. Remove it first to use another domain.`);
    let added;
    try { added = await hosting.addDomain(domain); } catch (err) {
      log.error('webAddress: hosting refused the domain', { name: err?.name || 'Error' });
      fail(503, 'unavailable', UNAVAILABLE);
    }
    const at = now();
    const next = { domain, state: WAITING, records: added.records, requestedBy: actor.email, createdAt: at, updatedAt: at, lastCheckedAt: null };
    await ref.set(next);
    await audit('add', { domain });
    return view(next, env);
  }
  if (body.action === 'check') {
    if (!record) fail(409, 'conflict', 'Add a domain first.');
    try {
      return view(await checkRecord({ db, hosting, identity, env, now, record }), env);
    } catch (err) {
      log.error('webAddress: the check failed', { name: err?.name || 'Error' });
      fail(503, 'unavailable', UNAVAILABLE);
    }
  }
  if (body.action === 'remove') {
    if (!record) return view(null, env);
    try { await hosting.removeDomain(record.domain); } catch (err) {
      log.error('webAddress: hosting did not remove the domain', { name: err?.name || 'Error' });
      fail(503, 'unavailable', UNAVAILABLE);
    }
    await ref.delete();
    await audit('remove', { domain: record.domain });
    return view(null, env);
  }
  return fail(400, 'bad-request', 'Choose status, add, check or remove.');
}

function createWebAddressHandler({ db, auth, getConfig, hosting, identity, env = process.env, now = () => new Date(), log = console }) {
  return async function webAddress(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'operator' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      if (body.action !== 'status') {
        const policy = await checkDemoWrites({ db });
        if (!policy.ok) return sendError(res, policy.status, policy.code, policy.message);
      }
      return res.status(200).json(await act({ db, hosting, identity, env, now, body, actor: { uid: verdict.uid, email: verdict.email }, log }));
    } catch (err) {
      if (err instanceof WebAddressError) return sendError(res, err.status, err.code, err.message);
      log.error('webAddress failed', { name: err?.name || 'Error' });
      return sendError(res, 503, 'unavailable', UNAVAILABLE);
    }
  };
}

async function googleCall({ fetchImpl, getAccessToken, url, method = 'GET', body, missingOk = false }) {
  const token = await getAccessToken({ fetchImpl });
  const response = await fetchImpl(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (missingOk && response.status === 404) return null;
  if (!response.ok) throw new Error(`Google API answered ${response.status}`);
  return response.status === 204 ? {} : response.json();
}

const ACTIONS = Object.freeze({ ADD: 'add', REMOVE: 'remove' });

/**
 * The records Hosting still needs changed, in plain fields: what to add,
 * and conflicting records to remove (an old A record, another site's TXT).
 */
function recordsToChange(domain) {
  const desired = Array.isArray(domain?.requiredDnsUpdates?.desired) ? domain.requiredDnsUpdates.desired : [];
  return desired.flatMap((set) => (Array.isArray(set.records) ? set.records : []))
    .filter((record) => ACTIONS[record.requiredAction])
    .map((record) => ({ action: ACTIONS[record.requiredAction], type: record.type, host: record.domainName, value: record.rdata }));
}

/** Firebase Hosting custom domains (v1beta1) for this project's site. */
function createHostingClient({ projectId, site, fetchImpl = globalThis.fetch, getAccessToken }) {
  const base = `${HOSTING_API}/projects/${encodeURIComponent(projectId)}/sites/${encodeURIComponent(site)}/customDomains`;
  // Null while Hosting has no such domain, or has not finished making it.
  const read = (domain) => googleCall({ fetchImpl, getAccessToken, url: `${base}/${encodeURIComponent(domain)}`, missingOk: true });
  return {
    /**
     * Create the domain, reuse it when Hosting already has it, or restore it
     * when it was removed in the last 30 days. Creating is a long-running
     * operation; when it has not finished, there are no records yet and the
     * next check reads them.
     */
    async addDomain(domain) {
      const found = await read(domain);
      if (found && !found.deleteTime) return { records: recordsToChange(found) };
      if (found) {
        await googleCall({ fetchImpl, getAccessToken, method: 'POST', url: `${base}/${encodeURIComponent(domain)}:undelete`, body: {} });
      } else {
        await googleCall({ fetchImpl, getAccessToken, method: 'POST', url: `${base}?customDomainId=${encodeURIComponent(domain)}`, body: {} });
      }
      const after = await read(domain);
      return { records: after ? recordsToChange(after) : [] };
    },
    async readDomain(domain) {
      const found = await read(domain);
      if (!found) return { live: false, records: [] };
      const live = found.hostState === 'HOST_ACTIVE' && found.ownershipState === 'OWNERSHIP_ACTIVE' && found.cert?.state === 'CERT_ACTIVE';
      return { live, records: recordsToChange(found) };
    },
    async removeDomain(domain) {
      await googleCall({ fetchImpl, getAccessToken, method: 'DELETE', url: `${base}/${encodeURIComponent(domain)}` });
    },
  };
}

/** The sign-in authorized domains (Identity Toolkit admin v2) for this project. */
function createIdentityClient({ projectId, fetchImpl = globalThis.fetch, getAccessToken }) {
  const url = `${IDENTITY_API}/projects/${encodeURIComponent(projectId)}/config`;
  return {
    async addAuthorizedDomain(domain) {
      const config = await googleCall({ fetchImpl, getAccessToken, url });
      const domains = Array.isArray(config.authorizedDomains) ? config.authorizedDomains : [];
      if (domains.includes(domain)) return;
      await googleCall({ fetchImpl, getAccessToken, method: 'PATCH', url: `${url}?updateMask=authorizedDomains`, body: { authorizedDomains: [...domains, domain] } });
    },
  };
}

function realClients(env = process.env) {
  const { fetchAccessToken } = require('../cms/publisher.cjs');
  const projectId = (env.EVENT_FIREBASE_PROJECT_ID || '').trim();
  const site = (env.EVENT_HOSTING_SITE || '').trim() || projectId;
  return {
    hosting: createHostingClient({ projectId, site, getAccessToken: fetchAccessToken }),
    identity: createIdentityClient({ projectId, getAccessToken: fetchAccessToken }),
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { onSchedule } = require('firebase-functions/v2/scheduler');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const deps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getEventConfig } = require('../core/config.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }), ...realClients(process.env) };
  };
  return {
    webAddress: onRequest({ region }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
      await createWebAddressHandler(deps())(req, res);
    }),
    webAddressCheck: onSchedule({ region, schedule: 'every 60 minutes' }, async () => {
      const { db, hosting, identity } = deps();
      await runWebAddressCheck({ db, hosting, identity });
    }),
  };
}

module.exports = {
  normalizeDomain, createWebAddressHandler, runWebAddressCheck, createHostingClient, createIdentityClient,
  get handlers() { return buildHandlers(); },
};
