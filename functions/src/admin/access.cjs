'use strict';

/**
 * Admin access — who may sign in to the admin panel, and at which tier
 * (issue #187). Two operator-only POST endpoints, following admin/config.cjs's
 * gate + audit conventions:
 *
 *   listAdminAccess {}               → { accounts: [{ email, tier }], callerEmail }
 *   setAdminAccess  { email, tier }  → { ok, email, tier, previousTier, changed }
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

const { ADMIN_TIERS, requireAdmin } = require('../core/auth.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');

const BOOTSTRAP = { collection: 'config', doc: 'bootstrap' };
/** Every value setAdminAccess accepts for `tier`. */
const ACCESS_TIERS = Object.freeze([...ADMIN_TIERS, 'none']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

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
 * the same reading core/auth.cjs resolveAdminTier gives it.
 *
 * @param {object|null|undefined} bootstrap
 * @returns {Array<{ email: string, tier: 'operator'|'staff' }>}
 */
function accountsOf(bootstrap) {
  const operators = normalizeList(bootstrap?.adminEmails).sort();
  const staff = normalizeList(bootstrap?.staffEmails)
    .filter((email) => !operators.includes(email))
    .sort();
  return [
    ...operators.map((email) => ({ email, tier: 'operator' })),
    ...staff.map((email) => ({ email, tier: 'staff' })),
  ];
}

/**
 * Apply one access change inside a transaction on config/bootstrap.
 *
 * @param {{ db: object, email: string, tier: 'operator'|'staff'|'none' }} args
 * @returns {Promise<{ ok: true, changed: boolean, tierChanged: boolean,
 *                     previousTier: 'operator'|'staff'|null } |
 *                    { ok: false, status: 409, code: string, message: string }>}
 */
async function applyAccessChange({ db, email, tier }) {
  const ref = db.collection(BOOTSTRAP.collection).doc(BOOTSTRAP.doc);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored = snap.exists ? snap.data() : {};
    const operators = normalizeList(stored.adminEmails);
    const staff = normalizeList(stored.staffEmails).filter((entry) => !operators.includes(entry));
    const previousTier = operators.includes(email) ? 'operator' : staff.includes(email) ? 'staff' : null;
    const nextTier = tier === 'none' ? null : tier;

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

    const listsChanged = (before, after) =>
      before.length !== after.length || before.some((entry, index) => entry !== after[index]);
    // A no-op is answered, not written — but a stored list that is merely
    // mis-normalized IS a change worth writing, so the comparison is on the
    // normalized lists against what was stored, not on the tier alone. What
    // is written is what is reported: a mixed-case entry the rules newly
    // match once it is lowercased is an effective grant, and the caller
    // audits and refreshes on `changed`.
    const changed = previousTier !== nextTier
      || listsChanged(Array.isArray(stored.adminEmails) ? stored.adminEmails : [], nextOperators)
      || listsChanged(Array.isArray(stored.staffEmails) ? stored.staffEmails : [], nextStaff);
    if (changed) {
      tx.set(ref, { adminEmails: nextOperators, staffEmails: nextStaff }, { merge: true });
    }
    return { ok: true, changed, tierChanged: previousTier !== nextTier, previousTier };
  });
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           log?: Pick<Console, 'error'|'warn'> }} deps
 */
function createListAdminAccessHandler({ db, auth, getConfig, log = console }) {
  return async function listAdminAccess(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    let snap;
    try {
      snap = await db.collection(BOOTSTRAP.collection).doc(BOOTSTRAP.doc).get();
    } catch (err) {
      log.error('listAdminAccess read failed', err);
      return internal(res, 'The access list is temporarily unavailable.');
    }
    res.status(200).json({
      accounts: accountsOf(snap.exists ? snap.data() : null),
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
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const email = readEmail(req.body?.email);
    if (!email) return badRequest(res, 'email: must be an email address.');
    const tier = req.body?.tier;
    if (!ACCESS_TIERS.includes(tier)) {
      return badRequest(res, `tier: must be one of ${ACCESS_TIERS.join(', ')}.`);
    }

    let result;
    try {
      result = await applyAccessChange({ db, email, tier });
    } catch (err) {
      log.error('setAdminAccess write failed', err);
      return internal(res, 'The access change could not be saved.');
    }
    if (!result.ok) return sendError(res, result.status, result.code, result.message);

    const nextTier = tier === 'none' ? null : tier;
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
          // The tier stood; the stored lists were rewritten normalized.
          ...(result.tierChanged ? {} : { normalized: true }),
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
  internals: { accountsOf, applyAccessChange, readEmail, normalizeList, ACCESS_TIERS },
};
