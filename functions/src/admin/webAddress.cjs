'use strict';

/**
 * `webAddress`: the custom web address, an optional upgrade (ADR 0007 §8,
 * slice P9a). POST `{ action }`:
 *
 *   status          → the stored address and its state (operator)
 *   add { domain }  → refused for every admin; the team sets up domains
 *   check           → read Hosting's state now ("Check now") (operator)
 *   remove          → refused for every admin; the team removes domains
 *                     with scripts/remove-web-address.cjs
 *
 * The team adds a domain with scripts/add-web-address.cjs (addWebAddress).
 *
 * STATES. `none` → `records` (the team adds the records; checks run) →
 * `switch` (Hosting serves the domain with a certificate, and the check has
 * made it an authorized sign-in domain; the site's public address still has
 * to change by a deploy) → `done` (EVENT_PUBLIC_URL is the domain).
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
 * means Hosting serves the domain with a certificate. Only then does the
 * check add the stored domain to the sign-in authorized domains, once, and
 * the state says so after that succeeds. A failure throws before any write,
 * so the record stays as it was and the next check retries.
 */
async function checkRecord({ db, hosting, identity, env, now, record }) {
  if (record.state === 'removing') return record;
  const ref = db.collection(COLLECTION).doc(DOC);
  const isStill = (data) => data && data.domain === record.domain && data.state !== 'removing';
  const at = now();
  const read = await hosting.readDomain(record.domain);
  const next = { ...record, lastCheckedAt: at, updatedAt: at };
  let authorized = false;
  if (read.live && !await identity.hasAuthorizedDomain(record.domain)) {
    // The Hosting read can take a while: never authorize a domain that was
    // removed or replaced in the meantime.
    const fresh = await ref.get();
    if (isStill(fresh.exists ? fresh.data() : null)) {
      await identity.addAuthorizedDomain(record.domain);
      authorized = true;
    }
  }
  if (!read.live || !await identity.hasAuthorizedDomain(record.domain)) {
    next.state = WAITING;
    next.records = read.records;
  } else {
    next.state = publicOrigin(env) === `https://${record.domain}` ? 'done' : 'switch';
    next.records = [];
    next.liveAt = record.liveAt ?? at;
  }
  // Write only if the record is still the one this check started from, so a
  // removal or a new domain in the meantime wins over a stale check.
  const result = await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!isStill(current.exists ? current.data() : null)) return { stale: true, data: current.exists ? current.data() : null };
    tx.set(ref, next);
    return { stale: false, data: next };
  });
  // A removal marks the record before it revokes, so a stale check sees the
  // mark here and takes back the sign-in domain it just added.
  if (result.stale && authorized) await identity.removeAuthorizedDomain(record.domain);
  return result.data;
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

async function act({ db, hosting, identity, env, now, body, log }) {
  const ref = db.collection(COLLECTION).doc(DOC);
  const snap = await ref.get();
  const record = snap.exists ? snap.data() : null;

  if (body.action === 'status') return view(record, env);
  if (body.action === 'check') {
    if (!record) fail(409, 'conflict', 'Contact us to set up your domain first.');
    try {
      return view(await checkRecord({ db, hosting, identity, env, now, record }), env);
    } catch (err) {
      log.error('webAddress: the check failed', { name: err?.name || 'Error' });
      fail(503, 'unavailable', UNAVAILABLE);
    }
  }
  return fail(400, 'bad-request', 'Choose status or check.');
}

function createWebAddressHandler({ db, auth, getConfig, hosting, identity, env = process.env, now = () => new Date(), log = console }) {
  return async function webAddress(req, res) {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const setupAction = body.action === 'add' || body.action === 'remove';
    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: setupAction ? 'staff' : 'operator' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);
    if (setupAction) {
      return sendError(res, 403, 'forbidden', 'To add or remove a custom domain, contact us.');
    }
    try {
      if (body.action !== 'status') {
        const policy = await checkDemoWrites({ db });
        if (!policy.ok) return sendError(res, policy.status, policy.code, policy.message);
      }
      return res.status(200).json(await act({ db, hosting, identity, env, now, body, log }));
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
      const live = !found.deleteTime && found.hostState === 'HOST_ACTIVE' && found.ownershipState === 'OWNERSHIP_ACTIVE' && found.cert?.state === 'CERT_ACTIVE';
      return { live, records: recordsToChange(found) };
    },
    async removeDomain(domain) {
      await googleCall({ fetchImpl, getAccessToken, method: 'DELETE', url: `${base}/${encodeURIComponent(domain)}`, missingOk: true });
    },
  };
}

/** The sign-in authorized domains (Identity Toolkit admin v2) for this project. */
function createIdentityClient({ projectId, fetchImpl = globalThis.fetch, getAccessToken }) {
  const url = `${IDENTITY_API}/projects/${encodeURIComponent(projectId)}/config`;
  return {
    async hasAuthorizedDomain(domain) {
      const config = await googleCall({ fetchImpl, getAccessToken, url });
      return Array.isArray(config.authorizedDomains) && config.authorizedDomains.includes(domain);
    },
    async removeAuthorizedDomain(domain) {
      const config = await googleCall({ fetchImpl, getAccessToken, url });
      const domains = Array.isArray(config.authorizedDomains) ? config.authorizedDomains : [];
      if (!domains.includes(domain)) return;
      await googleCall({ fetchImpl, getAccessToken, method: 'PATCH', url: `${url}?updateMask=authorizedDomains`,
        body: { authorizedDomains: domains.filter((entry) => entry !== domain) } });
    },
    async addAuthorizedDomain(domain) {
      const config = await googleCall({ fetchImpl, getAccessToken, url });
      const domains = Array.isArray(config.authorizedDomains) ? config.authorizedDomains : [];
      if (domains.includes(domain)) return;
      await googleCall({ fetchImpl, getAccessToken, method: 'PATCH', url: `${url}?updateMask=authorizedDomains`, body: { authorizedDomains: [...domains, domain] } });
    },
  };
}

/** Operator tooling only. Preserve the record until both revocations succeed. */
async function removeWebAddress({ db, hosting, identity, domain }) {
  const ref = db.collection(COLLECTION).doc(DOC);
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.data().domain !== domain) throw new Error('Domain does not match the stored web address');
    tx.update(ref, { state: 'removing' });
  });
  await identity.removeAuthorizedDomain(domain);
  await hosting.removeDomain(domain);
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists && current.data().domain === domain && current.data().state === 'removing') tx.delete(ref);
  });
}

/**
 * Operator tooling only. Hosting comes first and the record last: the
 * Hosting call is safe to repeat, so a run that fails part way stores
 * nothing and the same command finishes it. Sign-in is not touched here;
 * the check authorizes the domain once Hosting serves it. Returns an
 * outcome: invalid, other-domain, removing, stored, planned or added.
 */
async function addWebAddress({ db, hosting, domain: value, dryRun = false, now = () => new Date() }) {
  const domain = normalizeDomain(value);
  if (!domain) return { outcome: 'invalid' };
  const ref = db.collection(COLLECTION).doc(DOC);
  const snap = await ref.get();
  const stored = snap.exists ? snap.data() : null;
  if (stored) {
    if (stored.domain !== domain) return { outcome: 'other-domain', domain, record: stored };
    return { outcome: stored.state === 'removing' ? 'removing' : 'stored', domain, record: stored };
  }
  if (dryRun) return { outcome: 'planned', domain };
  const added = await hosting.addDomain(domain);
  const at = now();
  const record = { domain, state: WAITING, records: added.records, createdAt: at, updatedAt: at, lastCheckedAt: null };
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists) throw new Error('A web address was stored while this ran');
    tx.set(ref, record);
  });
  return { outcome: 'added', domain, record };
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
  normalizeDomain, addWebAddress, removeWebAddress, realClients, createWebAddressHandler, runWebAddressCheck, createHostingClient, createIdentityClient,
  get handlers() { return buildHandlers(); },
};
