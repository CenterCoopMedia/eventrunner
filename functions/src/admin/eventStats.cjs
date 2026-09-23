'use strict';

/**
 * The event's figures for the admin overview (issue #178). One staff-tier
 * POST endpoint:
 *
 *   getEventStats {} → { readAt, registrations, tickets, speakers, content, errors, funnel }
 *
 * EVERY FIGURE IS A SERVER AGGREGATE (parity plan, M9). The handler asks
 * Firestore for `count()` aggregates and for nothing else, so no document
 * body is read, and the answer is integers and one timestamp. The overview
 * page reads this endpoint and never reads `users`, `tickets`, `speakers`,
 * or `system_errors` in the browser (firestore.rules closes the last two to
 * every client).
 *
 * THIRTY AGGREGATES IN ONE Promise.all. Each is a whole collection or one
 * `==` filter, so the single-field indexes Firestore keeps by default serve
 * every one and firestore.indexes.json does not change:
 *
 *   users          total, one per REGISTRATION_STATUSES, profileComplete == true   6
 *   tickets        total, one per TICKET_STATUSES                                  5
 *   speakers       total, one per SPEAKER_STATUSES                                 6
 *   content        per PUBLISHABLE_COLLECTIONS: live `visible == true` (what the
 *                  rules serve publicly) and draft `status == 'dirty'` (the
 *                  predicate cms/store.cjs listDirty uses)                         12
 *   system_errors  resolved == false                                               1
 *
 * The status keys come from the shared constants, so a status added there is
 * counted here with no second list to keep in step. A total is the whole
 * collection, so a record whose status is missing or unknown still counts in
 * it: the parts need not add up to the total, and the page never says they do.
 *
 * THE FUNNEL (issue #181) is summed here from those counts, so the page
 * prints it and adds nothing: accounts (every account, revoked included),
 * then ticketed or approved, then approved. The stages nest because an
 * admin can approve a pending account directly (shared/registration
 * TRANSITIONS), so "ticketed" alone would not contain "approved".
 *
 * ALL OR NOTHING. A failed aggregate is logged and the call answers 500 with
 * no figures. A page that showed 29 figures beside a zero nobody measured
 * would state something false.
 *
 * STAFF TIER (issue #186). The overview is staff visible (parity plan, M9
 * item 9), so the gate asks for staff, which admits both tiers. The
 * unresolved error count is a number, never a row: the rows stay behind the
 * operator-only listSystemErrors.
 *
 * No admin_logs row: this is a read of counts, like listSystemErrors and
 * ticketingListTickets. No cache and no paging: the page calls on mount and
 * on Refresh only, so one press costs thirty aggregates.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, methodNotAllowed, internal } = require('../core/errors.cjs');
const { PUBLISHABLE_COLLECTIONS, draftCollectionFor } = require('../cms/blockTypes.cjs');
const { internals: { TICKETS, TICKET_STATUSES } } = require('../ticketing/index.cjs');
const { REGISTRATION_STATUSES } = require('shared/registration');
const { SPEAKER_STATUSES } = require('shared/speaker');

const STATS_UNAVAILABLE = 'The event figures are not available right now. Try again.';

/**
 * Every aggregate the answer needs, each with the key path its count lands
 * on. The order here is the key order of the answer.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @returns {Array<{ path: string[], query: { count: () => { get: () => Promise<object> } } }>}
 */
function aggregatePlan(db) {
  const plan = [];
  const add = (path, query) => plan.push({ path, query });

  const users = db.collection('users');
  add(['registrations', 'total'], users);
  for (const status of REGISTRATION_STATUSES) {
    add(['registrations', 'byStatus', status], users.where('registrationStatus', '==', status));
  }
  add(['registrations', 'profileComplete'], users.where('profileComplete', '==', true));

  const tickets = db.collection(TICKETS);
  add(['tickets', 'total'], tickets);
  for (const status of TICKET_STATUSES) {
    add(['tickets', 'byStatus', status], tickets.where('status', '==', status));
  }

  const speakers = db.collection('speakers');
  add(['speakers', 'total'], speakers);
  for (const status of SPEAKER_STATUSES) {
    add(['speakers', 'byStatus', status], speakers.where('status', '==', status));
  }

  for (const name of PUBLISHABLE_COLLECTIONS) {
    add(['content', name, 'published'], db.collection(name).where('visible', '==', true));
    add(['content', name, 'drafts'], db.collection(draftCollectionFor(name)).where('status', '==', 'dirty'));
  }

  add(['errors', 'unresolved'], db.collection('system_errors').where('resolved', '==', false));
  return plan;
}

/** A count from an aggregate snapshot. Anything but a whole number is a failure. */
function countOf(snapshot) {
  const value = snapshot?.data?.()?.count;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`count() answered ${JSON.stringify(value)}`);
  }
  return value;
}

function setPath(target, path, value) {
  let node = target;
  for (const key of path.slice(0, -1)) {
    node[key] ??= {};
    node = node[key];
  }
  node[path.at(-1)] = value;
}

/**
 * Run every aggregate and shape the answer. Throws when any aggregate fails;
 * the handler turns that into a 500 with no figures.
 *
 * @param {{ db: FirebaseFirestore.Firestore, now?: () => number }} args
 * @returns {Promise<object>}
 */
async function readEventStats({ db, now = Date.now }) {
  const plan = aggregatePlan(db);
  const snapshots = await Promise.all(plan.map(({ query }) => query.count().get()));
  const stats = { readAt: new Date(now()).toISOString() };
  plan.forEach(({ path }, index) => setPath(stats, path, countOf(snapshots[index])));
  stats.funnel = funnelOf(stats.registrations);
  return stats;
}

/**
 * The registration funnel, three nested stages from the account counts.
 *
 * @param {{ total: number, byStatus: Record<string, number> }} registrations
 * @returns {Array<{ id: string, count: number }>}
 */
function funnelOf(registrations) {
  const { ticketed, approved } = registrations.byStatus;
  return [
    { id: 'accounts', count: registrations.total },
    { id: 'ticketed-or-approved', count: ticketed + approved },
    { id: 'approved', count: approved },
  ];
}

/**
 * @param {{ db: FirebaseFirestore.Firestore, auth, getConfig, now?: () => number, log?: Console }} deps
 */
function createGetEventStatsHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function getEventStats(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    // The gate runs before any aggregate: a refused caller costs one read of
    // config/bootstrap and nothing else.
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    let stats;
    try {
      stats = await readEventStats({ db, now });
    } catch (err) {
      log.error('getEventStats aggregate failed', err);
      return internal(res, STATS_UNAVAILABLE);
    }
    res.status(200).json(stats);
  };
}

/** Deployable export (spec §1.3): getEventStats. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    getEventStats: onRequest({ region }, withCors(async (req, res) => {
      await createGetEventStatsHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  createGetEventStatsHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { aggregatePlan, readEventStats, countOf, funnelOf, STATS_UNAVAILABLE },
};
