'use strict';

const { validateTicketAccessPolicy } = require('shared/ticketAccess');
const { getTierA } = require('../core/config.cjs');
const { isDeepStrictEqual } = require('node:util');

const POLICIES = 'ticket_access_policies';
const GRANTS = 'ticket_access_grants';
const PAGE_SIZE = 100;
const revisionRef = (db, revision) => db.collection(POLICIES).doc(`revision-${revision}`);
const controlRef = (db) => db.collection(POLICIES).doc('current');
const same = isDeepStrictEqual;

function validState(state) {
  return Number.isSafeInteger(state?.effectiveRevision) && state.effectiveRevision >= 0 &&
    (state.candidateRevision === null || (Number.isSafeInteger(state.candidateRevision) && state.candidateRevision > state.effectiveRevision)) &&
    (state.cursor === null || (typeof state.cursor === 'string' && state.cursor.length > 0)) &&
    Number.isSafeInteger(state.processed) && state.processed >= 0 && Number.isSafeInteger(state.remaining) && state.remaining >= 0;
}

/** Canonical references and deployment scope are always server-loaded. */
async function policyContext({ db, tx, env }) {
  const tierA = getTierA(env);
  const event = (await tx.get(db.collection('config').doc('event'))).data();
  const sessions = await tx.get(db.collection('cmsSchedule'));
  return { provider: tierA.ticketingProvider, eventId: tierA.ticketingEventId,
    dayIds: Array.isArray(event?.days) ? event.days.map((day) => day?.id) : [],
    sessionIds: sessions.docs.map((session) => session.id) };
}

// Publication checks canonical membership once. Later reads still validate the
// closed shape and deployment scope, while deleted CMS resources lose membership.
function storedPolicy(policy, context) {
  const classes = Array.isArray(policy?.classes) ? policy.classes : [];
  const refs = (key) => [...new Set(classes.flatMap((entry) =>
    Array.isArray(entry?.resources?.sessions?.[key]) ? entry.resources.sessions[key] : []))];
  return validateTicketAccessPolicy(policy, { ...context, dayIds: refs('dayIds'), sessionIds: refs('sessionIds') });
}

/** Read in the account transaction; no cached policy or event payload is used. */
async function readTicketResourcePolicy({ db, tx, env = process.env }) {
  const control = (await tx.get(controlRef(db))).data();
  if (!control) return null; // Existing full-event deployments have no resource policy.
  if (!validState(control)) return { policy: null, context: null };
  const revision = control.candidateRevision ?? control.effectiveRevision;
  if (!Number.isSafeInteger(revision) || revision < 1) return { policy: null, context: null };
  const policy = (await tx.get(revisionRef(db, revision))).data()?.policy;
  const context = await policyContext({ db, tx, env });
  const checked = storedPolicy(policy, context);
  if (!checked.ok || checked.value.revision !== revision) return { policy: null, context };
  const days = new Set(context.dayIds);
  const sessions = new Set(context.sessionIds);
  for (const entry of checked.value.classes) {
    entry.resources.sessions.dayIds = entry.resources.sessions.dayIds.filter((id) => days.has(id));
    entry.resources.sessions.sessionIds = entry.resources.sessions.sessionIds.filter((id) => sessions.has(id));
  }
  return { policy: checked.value, context };
}

/**
 * Operator-only server helper, deliberately not an HTTP endpoint or activation.
 * Stage one immutable revision, recompute users inline, then publish its pointer.
 * Progress is on the policy control document; failed pages repeat on resumption.
 * No worker, scheduled retry, or second queue consumes this state.
 */
async function publishTicketAccessPolicy({ db, policy, expectedRevision, env = process.env, now = () => new Date() }) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('An expected effective revision is required.');
  const total = (await db.collection('users').count().get()).data().count;
  const stateRef = controlRef(db);
  let state = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(stateRef);
    const current = snapshot.data() || { effectiveRevision: 0, candidateRevision: null, cursor: null, processed: 0, remaining: 0 };
    if (!validState(current)) throw new Error('Invalid ticket resource publication state.');
    const context = await policyContext({ db, tx, env });
    const revision = policy?.revision;
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid ticket resource policy revision.');
    const stored = await tx.get(revisionRef(db, revision));
    const resuming = stored.exists && (current.candidateRevision === revision || current.effectiveRevision === revision);
    const checked = resuming ? storedPolicy(policy, context) : validateTicketAccessPolicy(policy, context);
    if (!checked.ok) throw new Error('Invalid ticket resource policy.');
    if (stored.exists && !same(stored.data()?.policy, checked.value)) throw new Error('Ticket resource policy revisions are immutable.');
    if (current.effectiveRevision === revision && current.candidateRevision === null && stored.exists) return current;
    if (current.effectiveRevision !== expectedRevision || revision <= expectedRevision) throw new Error('Ticket resource policy revision changed.');
    if (current.candidateRevision !== null && current.candidateRevision !== revision) throw new Error('Another ticket resource revision is being recomputed.');
    if (current.candidateRevision === revision) {
      if (!stored.exists) throw new Error('The immutable ticket resource revision is missing.');
      return current;
    }
    if (!stored.exists) tx.create(revisionRef(db, revision), { policy: checked.value });
    const next = { effectiveRevision: expectedRevision, candidateRevision: revision,
      cursor: null, processed: 0, remaining: total, updatedAt: now() };
    tx.set(stateRef, next);
    return next;
  });
  const revision = policy.revision;
  const receipt = () => ({ revision, processed: state.processed, remaining: state.remaining,
    complete: state.effectiveRevision === revision && state.candidateRevision === null });
  try {
    while (state.candidateRevision === revision) {
      let query = db.collection('users').orderBy('__name__').limit(PAGE_SIZE);
      if (state.cursor !== null) query = query.startAfter(state.cursor);
      const page = await query.get();
      const { recomputeEntitlement } = require('./entitlement.cjs');
      for (const account of page.docs) {
        const result = await recomputeEntitlement({ db, uid: account.id, env, now });
        if (result.grantStatus === 'invalid') throw new Error('Ticket resource grant could not be derived; publication remains incomplete.');
      }
      const cursor = page.docs.at(-1)?.id ?? state.cursor;
      let rest = db.collection('users').orderBy('__name__');
      if (cursor !== null) rest = rest.startAfter(cursor);
      const remaining = (await rest.count().get()).data().count;
      state = await db.runTransaction(async (tx) => {
        const current = (await tx.get(stateRef)).data();
        if (!validState(current)) throw new Error('Invalid ticket resource publication state.');
        if (current?.effectiveRevision === revision && current.candidateRevision === null) return current;
        if (current?.candidateRevision !== revision || current.effectiveRevision !== expectedRevision) throw new Error('Ticket resource publication changed.');
        if (current.cursor !== state.cursor) return current; // Another identical sweep completed this page.
        const more = await tx.get(rest.limit(1));
        const complete = more.empty;
        const next = { effectiveRevision: complete ? revision : expectedRevision,
          candidateRevision: complete ? null : revision, cursor: complete ? null : cursor,
          processed: current.processed + page.size, remaining: complete ? 0 : Math.max(1, remaining), updatedAt: now() };
        tx.set(stateRef, next);
        return next;
      });
    }
    return receipt();
  } catch (error) {
    error.progress = receipt();
    throw error;
  }
}

module.exports = { readTicketResourcePolicy, publishTicketAccessPolicy, internals: { POLICIES, GRANTS, PAGE_SIZE, policyContext, storedPolicy } };
