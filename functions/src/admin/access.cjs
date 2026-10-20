'use strict';

/**
 * Admin access — who may sign in to the admin panel, and at which tier
 * (issue #187). Two operator-only POST endpoints, following admin/config.cjs's
 * gate + audit conventions:
 *
 *   listAdminAccess {}  → { accounts: [{ email, tier, expiresAt?, expiryState? }], callerEmail }
 *   setAdminAccess  { email, tier, expiresAt? }
 *                       → { ok, email, tier, previousTier, changed, expiresAt?, previousExpiresAt? }
 *
 * `config/bootstrap` is server-only in both directions (firestore.rules
 * denies even an operator a direct read), so these two endpoints are the
 * ONLY way the browser ever sees or changes the two lists. Both read the
 * document fresh from Firestore rather than through the config cache: the
 * page has to show the truth right after a change, and the write has to
 * decide "is this the last operator" against what is stored now.
 *
 * `tier` on setAdminAccess is one of `operator`, `staff`, or `none`
 * (revoke). The address is trimmed and lowercased before anything else,
 * because firestore.rules matches the stored list against the lowercased
 * token email — a mixed-case entry is an admin who can never sign in. An
 * address is on exactly one list after a write: granting operator removes
 * it from staff, granting staff removes it from operators, `none` removes
 * it from both.
 *
 * THE LAST OPERATOR. A write that would leave `adminEmails` empty is
 * refused (409 `last-operator`): demoting or removing the last operator,
 * the caller's own grant included. Staff cannot restore anyone's access,
 * so a deployment with no operator is a deployment nobody can administer
 * without a redeploy of config.
 *
 * EXPIRING STAFF ACCESS (issue #331). A staff grant may carry `expiresAt`,
 * an ISO 8601 time with an explicit offset (`Z` or `+hh:mm`), later than
 * now and at most MAX_STAFF_ACCESS_DAYS from now. It is stored in the
 * `staffExpiry` map on the same document, keyed by the lowercased address,
 * as a Timestamp. core/auth.cjs resolveAdminTier and firestore.rules
 * isStaff() both refuse the grant from that instant on, at request time;
 * nothing sweeps it, and the address stays listed (with `expiryState:
 * 'expired'`) until an operator removes or renews it. Only staff access can
 * end: `expiresAt` with `operator` or `none` is refused, and making an
 * account an operator or removing it drops its end time, so the last
 * operator can never expire. A staff grant without `expiresAt` is
 * permanent, and turns a temporary grant permanent. A rewrite of the
 * document never drops another address's end time, a malformed one
 * included: that would turn a refused grant into a permanent one. When the
 * map itself is not a map, every other staff address is written with a
 * null end time, which keeps it refused, as it was. The response and the
 * admin_logs row carry `expiresAt` and `previousExpiresAt` whenever either
 * is set, so a permanent grant reads as it did before #331.
 *
 * Every accepted change writes an admin_logs row through the shared
 * logAdminAction, carrying the address and the tier it moved to and from
 * in `details`. A write that changes nothing (`changed: false`) writes no
 * row: the audit trail records changes, not clicks.
 *
 * A change takes effect at once everywhere that decides access: the rules
 * and the browser's tier probe read the document live, and so does
 * requireAdmin on every server (core/auth.cjs loadBootstrap), so a granted
 * account is admitted and a revoked one refused on its very next request,
 * whichever container answers it. The handler also refreshes THIS
 * container's config cache (core/config.cjs) for the readers that still
 * take the cached copy — readiness counts and the attendee-access floor —
 * which elsewhere catch up within the cache's five-minute TTL.
 */

const {
  ADMIN_TIERS, STAFF_EXPIRY_FIELD, requireAdmin, staffExpiryOf, internals: { expiryMillis },
} = require('../core/auth.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');

const BOOTSTRAP = { collection: 'config', doc: 'bootstrap' };
/** Every value setAdminAccess accepts for `tier`. */
const ACCESS_TIERS = Object.freeze([...ADMIN_TIERS, 'none']);
const { EMAIL_ADDRESS_RE: EMAIL_RE } = require('shared/email');
const MAX_EMAIL_LENGTH = 254;
/** The longest a temporary staff grant may run, from the moment it is set. */
const MAX_STAFF_ACCESS_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
// A full date and time with an explicit offset. Without the offset the
// server would read the time in its own zone, which nobody chose.
const EXPIRES_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** A plain Firestore map, the shape the rules' `is map` accepts. */
function isPlainMap(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The end time the request names, as milliseconds, or null for none.
 *
 * @param {unknown} value the request's `expiresAt`
 * @param {string|null} tier the tier asked for, `null` for none
 * @param {number} nowMs
 * @returns {{ ok: true, expiresAtMs: number|null } | { ok: false, message: string }}
 */
function readExpiresAt(value, tier, nowMs) {
  if (value === undefined || value === null) return { ok: true, expiresAtMs: null };
  if (tier !== 'staff') {
    return { ok: false, message: 'expiresAt: only staff access can end. Operator access and removal take no end time.' };
  }
  if (typeof value !== 'string' || !EXPIRES_AT_RE.test(value)) {
    return { ok: false, message: 'expiresAt: must be a date and time with a time zone offset, such as 2026-10-27T17:00:00Z.' };
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return { ok: false, message: 'expiresAt: must be a date and time with a time zone offset, such as 2026-10-27T17:00:00Z.' };
  }
  if (ms <= nowMs) return { ok: false, message: 'expiresAt: must be later than now.' };
  if (ms > nowMs + MAX_STAFF_ACCESS_DAYS * DAY_MS) {
    return { ok: false, message: `expiresAt: must be at most ${MAX_STAFF_ACCESS_DAYS} days from now.` };
  }
  return { ok: true, expiresAtMs: ms };
}

/** An end time as an ISO string, or null when there is none or it cannot be read. */
function isoOf(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Trim, lowercase, drop anything that is not a string, de-duplicate. */
function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(
    list
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )];
}

/**
 * The address the request names, normalized, or null when it is not one.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function readEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * The two lists as the page shows them: operators first, then staff, each
 * group by address. An address on both lists shows once, as an operator —
 * the same reading core/auth.cjs resolveAdminTier gives it. A staff row
 * with an end time also carries `expiresAt` (ISO, or null when it cannot
 * be read) and `expiryState`: `active` before the end time, `expired` from
 * it on, `invalid` when it cannot be read (refused, as the rules refuse
 * it). The state is decided by the server clock at `nowMs`, not the
 * browser's.
 *
 * @param {object|null|undefined} bootstrap
 * @param {number} [nowMs]
 * @returns {Array<{ email: string, tier: 'operator'|'staff',
 *                   expiresAt?: string|null, expiryState?: 'active'|'expired'|'invalid' }>}
 */
function accountsOf(bootstrap, nowMs = Date.now()) {
  const operators = normalizeList(bootstrap?.adminEmails).sort();
  const staff = normalizeList(bootstrap?.staffEmails)
    .filter((email) => !operators.includes(email))
    .sort();
  return [
    ...operators.map((email) => ({ email, tier: 'operator' })),
    ...staff.map((email) => {
      const expiry = staffExpiryOf(bootstrap, email);
      if (!expiry.temporary) return { email, tier: 'staff' };
      const expiryState = expiry.expiresAtMs === null
        ? 'invalid'
        : nowMs < expiry.expiresAtMs ? 'active' : 'expired';
      return { email, tier: 'staff', expiresAt: isoOf(expiry.expiresAtMs), expiryState };
    }),
  ];
}

/**
 * The `staffExpiry` map after a change: the end time of every other staff
 * address carried exactly as stored (a malformed one too, so a refused
 * grant stays refused), the changed address's own end time set or
 * dropped, and keys for addresses no longer on the staff list dropped.
 *
 * @param {unknown} storedMap
 * @param {string[]} nextStaff
 * @param {string} email
 * @param {number|null} expiresAtMs the changed address's end time, when it is staff
 * @returns {Record<string, unknown>}
 */
function nextExpiryMap(storedMap, nextStaff, email, expiresAtMs) {
  const readable = storedMap === undefined || isPlainMap(storedMap);
  const next = {};
  for (const entry of nextStaff) {
    if (entry === email) continue;
    if (!readable) next[entry] = null;
    else if (storedMap !== undefined && hasOwn(storedMap, entry)) next[entry] = storedMap[entry];
  }
  if (expiresAtMs !== null && nextStaff.includes(email)) next[email] = new Date(expiresAtMs);
  return next;
}

/** Whether the stored map already says what `next` says. */
function sameExpiryMap(storedMap, next) {
  const nextKeys = Object.keys(next);
  if (storedMap === undefined) return nextKeys.length === 0;
  if (!isPlainMap(storedMap)) return false;
  const storedKeys = Object.keys(storedMap);
  if (storedKeys.length !== nextKeys.length) return false;
  return nextKeys.every((key) => {
    if (!hasOwn(storedMap, key)) return false;
    const value = next[key];
    // The changed address's own end time is a fresh Date: compare instants.
    if (value instanceof Date) return expiryMillis(storedMap[key]) === value.getTime();
    return storedMap[key] === value;
  });
}

/**
 * Apply one access change inside a transaction on config/bootstrap.
 *
 * The document is written whole (not merged) when it changes, because a
 * merge cannot drop a key from the `staffExpiry` map; the transaction read
 * the document it writes, so no other field is lost.
 *
 * @param {{ db: object, email: string, tier: 'operator'|'staff'|'none',
 *           expiresAtMs?: number|null }} args
 * @returns {Promise<{ ok: true, changed: boolean, tierChanged: boolean, expiryChanged: boolean,
 *                     previousTier: 'operator'|'staff'|null,
 *                     previousExpiresAtMs: number|null, expiresAtMs: number|null } |
 *                    { ok: false, status: 409, code: string, message: string }>}
 */
async function applyAccessChange({ db, email, tier, expiresAtMs = null }) {
  const ref = db.collection(BOOTSTRAP.collection).doc(BOOTSTRAP.doc);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.exists ? snap.data() : {};
    const operators = normalizeList(stored.adminEmails);
    const staff = normalizeList(stored.staffEmails).filter((entry) => !operators.includes(entry));
    const previousTier = operators.includes(email) ? 'operator' : staff.includes(email) ? 'staff' : null;
    const nextTier = tier === 'none' ? null : tier;
    const previousExpiry = previousTier === 'staff' ? staffExpiryOf(stored, email) : { temporary: false };
    const previousExpiresAtMs = previousExpiry.temporary ? previousExpiry.expiresAtMs : null;
    const nextExpiresAtMs = nextTier === 'staff' ? expiresAtMs : null;

    const nextOperators = operators.filter((entry) => entry !== email);
    const nextStaff = staff.filter((entry) => entry !== email);
    if (nextTier === 'operator') nextOperators.push(email);
    if (nextTier === 'staff') nextStaff.push(email);

    if (nextOperators.length === 0) {
      return {
        ok: false,
        status: 409,
        code: 'last-operator',
        message: 'At least one operator must keep access. Grant another account operator access first.',
      };
    }

    const nextExpiry = nextExpiryMap(stored[STAFF_EXPIRY_FIELD], nextStaff, email, nextExpiresAtMs);
    // The address's own end time moved: set, changed, dropped, or no longer
    // unreadable.
    const expiryChanged = previousExpiry.temporary !== (nextExpiresAtMs !== null)
      || (previousExpiry.temporary && previousExpiresAtMs !== nextExpiresAtMs);

    const listsChanged = (before, after) =>
      before.length !== after.length || before.some((entry, index) => entry !== after[index]);
    // A no-op is answered, not written — but a stored list that is merely
    // mis-normalized IS a change worth writing, so the comparison is on the
    // normalized lists against what was stored, not on the tier alone. What
    // is written is what is reported: a mixed-case entry the rules newly
    // match once it is lowercased is an effective grant, and the caller
    // audits and refreshes on `changed`.
    const changed = previousTier !== nextTier
      || expiryChanged
      || listsChanged(Array.isArray(stored.adminEmails) ? stored.adminEmails : [], nextOperators)
      || listsChanged(Array.isArray(stored.staffEmails) ? stored.staffEmails : [], nextStaff)
      || !sameExpiryMap(stored[STAFF_EXPIRY_FIELD], nextExpiry);
    if (changed) {
      const next = { ...stored, adminEmails: nextOperators, staffEmails: nextStaff };
      if (Object.keys(nextExpiry).length > 0) next[STAFF_EXPIRY_FIELD] = nextExpiry;
      else delete next[STAFF_EXPIRY_FIELD];
      tx.set(ref, next);
    }
    return {
      ok: true,
      changed,
      tierChanged: previousTier !== nextTier,
      expiryChanged,
      previousTier,
      previousExpiresAtMs,
      expiresAtMs: nextExpiresAtMs,
    };
  });
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'error'|'warn'> }} deps
 */
function createListAdminAccessHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function listAdminAccess(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig, now }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    let snap;
    try {
      snap = await db.collection(BOOTSTRAP.collection).doc(BOOTSTRAP.doc).get();
    } catch (err) {
      log.error('listAdminAccess read failed', err);
      return internal(res, 'The access list is temporarily unavailable.');
    }
    res.status(200).json({
      accounts: accountsOf(snap.exists ? snap.data() : null, now()),
      callerEmail: gate.email,
    });
  };
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           refreshConfig?: () => Promise<unknown>, now?: () => number,
 *           log?: Pick<Console, 'error'|'warn'> }} deps
 */
function createSetAdminAccessHandler({ db, auth, getConfig, refreshConfig, now = Date.now, log = console }) {
  return async function setAdminAccess(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig, now }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const email = readEmail(req.body?.email);
    if (!email) return badRequest(res, 'email: must be an email address.');
    const tier = req.body?.tier;
    if (!ACCESS_TIERS.includes(tier)) {
      return badRequest(res, `tier: must be one of ${ACCESS_TIERS.join(', ')}.`);
    }
    const expiry = readExpiresAt(req.body?.expiresAt, tier === 'none' ? null : tier, now());
    if (!expiry.ok) return badRequest(res, expiry.message);

    let result;
    try {
      result = await applyAccessChange({ db, email, tier, expiresAtMs: expiry.expiresAtMs });
    } catch (err) {
      log.error('setAdminAccess write failed', err);
      return internal(res, 'The access change could not be saved.');
    }
    if (!result.ok) return sendError(res, result.status, result.code, result.message);

    const nextTier = tier === 'none' ? null : tier;
    // A permanent grant reads as it did before #331; an end time on either
    // side is stated, as an ISO string or null.
    const expiryFields = result.expiresAtMs !== null || result.previousExpiresAtMs !== null || result.expiryChanged
      ? { expiresAt: isoOf(result.expiresAtMs), previousExpiresAt: isoOf(result.previousExpiresAtMs) }
      : {};
    if (result.changed) {
      const actor = { uid: gate.uid, email: gate.email };
      await logAdminAction({
        db,
        action: 'setAdminAccess',
        docPath: `${BOOTSTRAP.collection}/${BOOTSTRAP.doc}`,
        actor,
        now,
        log,
        details: {
          email,
          tier: nextTier,
          previousTier: result.previousTier,
          ...expiryFields,
          // The tier and the end time stood; the stored lists were rewritten normalized.
          ...(result.tierChanged || result.expiryChanged ? {} : { normalized: true }),
        },
      });
      if (typeof refreshConfig === 'function') {
        try {
          await refreshConfig();
        } catch (err) {
          log.warn('config cache refresh after setAdminAccess failed', err);
        }
      }
    }
    res.status(200).json({
      ok: true,
      email,
      tier: nextTier,
      previousTier: result.previousTier,
      changed: result.changed,
      ...expiryFields,
    });
  };
}

/** Deployable exports (spec §1.3 admin/): listAdminAccess, setAdminAccess. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return {
      db,
      auth: getAuth(),
      getConfig: () => getEventConfig({ db }),
      refreshConfig: () => getEventConfig({ db, forceRefresh: true }),
    };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  const expose = (create) =>
    onRequest({ region }, withCors(async (req, res) => {
      await create(buildDeps())(req, res);
    }));

  return {
    listAdminAccess: expose(createListAdminAccessHandler),
    setAdminAccess: expose(createSetAdminAccessHandler),
  };
}

module.exports = {
  createListAdminAccessHandler,
  createSetAdminAccessHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    accountsOf, applyAccessChange, readEmail, readExpiresAt, normalizeList, ACCESS_TIERS, MAX_STAFF_ACCESS_DAYS,
  },
};
