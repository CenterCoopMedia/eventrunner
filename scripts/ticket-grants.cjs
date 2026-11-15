'use strict';

/**
 * Ticket resource grant migration for one client project (#1008). Runbook:
 * docs/operator/ticket-resource-grants.md.
 *
 *   inventory  Read-only. Counts tickets by provider, event and class ID,
 *              approved accounts by approvalSource, and grants at the
 *              candidate revision. With a policy (a file, or the staged or
 *              effective revision) it also projects each approved account's
 *              grant with the shared derivation. It reports whether the
 *              activation condition holds: every approved account with no
 *              approvalSource has a grant that covers at least one session.
 *   backfill   Recomputes every account with recomputeEntitlement, the same
 *              code the claim, ticket trigger and publication sweep run. A
 *              dry run is the default: the transactions are read-only and
 *              the writes they would make are counted, not made. --apply
 *              writes. A second --apply run writes nothing.
 *   publish    Checks a policy file, the expected effective revision and the
 *              activation condition. With --apply it runs
 *              publishTicketAccessPolicy (stage, sweep, publish) and reads
 *              the control document back.
 *   legacy     Rollback. With --apply it sets the control document to
 *              effective revision 0. Nothing is published.
 *
 * backfill, publish and legacy are dry runs unless --apply is given, and each
 * writes a JSON receipt to a new file.
 *
 *   EVENT_FIREBASE_PROJECT_ID=... EVENT_TICKETING_PROVIDER=... EVENT_TICKETING_EVENT_ID=... \
 *     node scripts/ticket-grants.cjs inventory [--policy <file>] [--out <new-file>]
 *     node scripts/ticket-grants.cjs backfill [--apply] --receipt <new-file>
 *     node scripts/ticket-grants.cjs publish --policy <file> --expected-revision <n> [--apply] --receipt <new-file>
 *     node scripts/ticket-grants.cjs legacy [--apply] --receipt <new-file>
 *
 * Output holds counts, class IDs and account uids, never emails or names.
 */

const { readFileSync, writeFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { ticketClassIdentity, validateTicketAccessPolicy, deriveTicketResourceGrant } = require('shared/ticketAccess');
const { readTicketResourcePolicy, publishTicketAccessPolicy, internals: { POLICIES, GRANTS, policyContext, storedPolicy } } = require('../functions/src/ticketing/resourceGrants.cjs');
const { recomputeEntitlement } = require('../functions/src/ticketing/entitlement.cjs');

const PAGE = 200;
// A plain read stands in for a transaction in the read-only inventory.
const READER = { get: (target) => target.get() };

async function eachDoc(db, name, visit) {
  let cursor = null;
  for (;;) {
    let query = db.collection(name).orderBy('__name__').limit(PAGE);
    if (cursor !== null) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) await visit(doc);
    if (page.size < PAGE) return;
    cursor = page.docs.at(-1).id;
  }
}

async function readControl(db) {
  return (await db.collection(POLICIES).doc('current').get()).data() ?? null;
}

function stagedRevision(control) {
  const revision = control?.candidateRevision ?? control?.effectiveRevision;
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

/** Existing sessions and the days that have one, as decideSessionGrant reads them. */
async function canonicalSessions(db) {
  const ids = new Set();
  const days = new Set();
  for (const doc of (await db.collection('cmsSchedule').get()).docs) {
    ids.add(doc.id);
    if (typeof doc.data().dayId === 'string') days.add(doc.data().dayId);
  }
  return { ids, days };
}

const coversSessions = (grant, canonical) => {
  const sessions = grant?.resources?.sessions;
  const list = (value) => (Array.isArray(value) ? value : []);
  return (sessions?.all === true && canonical.ids.size > 0) || list(sessions?.sessionIds).some((id) => canonical.ids.has(id)) ||
    list(sessions?.dayIds).some((id) => canonical.days.has(id));
};

/**
 * The policy to project: an operator policy wins, else the staged or effective
 * revision. A policy identical to the staged revision is a resumption: it gets
 * the stored-revision semantics the helper uses, so a CMS session deleted
 * since staging removes membership instead of failing validation. Any other
 * policy is checked against current canonical data, and like the helper it
 * cannot replace a stored revision with the same number.
 */
async function projectionPolicy({ db, env, control, policyInput }) {
  const context = await policyContext({ db, tx: READER, env });
  // No document, or the rollback state: legacy, with no policy to read.
  const legacy = !control || (control.effectiveRevision === 0 && (control.candidateRevision ?? null) === null);
  const stored = legacy ? null : await readTicketResourcePolicy({ db, tx: READER, env });
  const storedIssues = stored?.policy ? [] : [{ path: 'policy', message: 'The stored revision is not valid.' }];
  if (policyInput === undefined) {
    return stored ? { source: 'stored', policy: stored.policy, context, issues: storedIssues } : { source: 'none', policy: null, context, issues: [] };
  }
  const revision = policyInput?.revision;
  const raw = Number.isSafeInteger(revision) && revision >= 1
    ? (await db.collection(POLICIES).doc(`revision-${revision}`).get()).data()?.policy : undefined;
  const differs = [{ path: 'policy', message: 'The policy differs from the stored revision with the same number.' }];
  if (revision === stagedRevision(control)) {
    const checked = storedPolicy(policyInput, context);
    if (!checked.ok || !isDeepStrictEqual(checked.value, raw)) return { source: 'file', policy: null, context, issues: differs };
    return { source: 'file', policy: stored?.policy ?? null, context, issues: storedIssues };
  }
  const checked = validateTicketAccessPolicy(policyInput, context);
  if (checked.ok && raw !== undefined && !isDeepStrictEqual(checked.value, raw)) return { source: 'file', policy: null, context, issues: differs };
  return { source: 'file', policy: checked.value, context, issues: checked.issues };
}

async function inventoryTicketGrants({ db, env = process.env, policyInput }) {
  const control = await readControl(db);
  const { source, policy, context, issues } = await projectionPolicy({ db, env, control, policyInput });
  const canonical = await canonicalSessions(db);
  if (!context.provider || !context.eventId) throw new Error('EVENT_TICKETING_PROVIDER and EVENT_TICKETING_EVENT_ID are required.');
  const revision = policy?.revision ?? stagedRevision(control);
  const mapped = new Set((policy?.mappings ?? []).map((entry) => entry.sourceClassId));

  const classes = new Map();
  const claimed = new Map();
  const tickets = { total: 0, noClassId: 0, otherScope: 0, byClass: [], unmappedClassIds: [] };
  await eachDoc(db, 'tickets', (doc) => {
    const ticket = doc.data();
    tickets.total += 1;
    if (typeof ticket.claimedByUid === 'string' && ticket.claimedByUid) {
      claimed.set(ticket.claimedByUid, [...(claimed.get(ticket.claimedByUid) ?? []), ticket]);
    }
    const identity = ticketClassIdentity(ticket);
    if (!identity) { tickets.noClassId += 1; return; }
    if (identity.provider !== context.provider || identity.eventId !== context.eventId) { tickets.otherScope += 1; return; }
    const entry = classes.get(identity.classId) ?? { classId: identity.classId, total: 0, valid: 0 };
    entry.total += 1;
    if (ticket.status === 'valid') entry.valid += 1;
    classes.set(identity.classId, entry);
  });
  tickets.byClass = [...classes.values()].sort((a, b) => a.classId.localeCompare(b.classId));
  if (policy) tickets.unmappedClassIds = tickets.byClass.map((entry) => entry.classId).filter((id) => !mapped.has(id));

  const accounts = { approved: 0, byApprovalSource: {}, speakers: 0, needGrant: 0, currentGrant: 0,
    projectedNoSessions: policy ? 0 : null };
  const missing = { count: 0, currentGrant: 0, usable: 0, unresolvedUids: [] };
  await eachDoc(db, 'users', async (doc) => {
    const account = doc.data();
    if (account.registrationStatus !== 'approved') return;
    accounts.approved += 1;
    const sourceName = typeof account.approvalSource === 'string' ? account.approvalSource : 'missing';
    accounts.byApprovalSource[sourceName] = (accounts.byApprovalSource[sourceName] ?? 0) + 1;
    // The exemptions decideSessionGrant applies before it reads a grant.
    if (account.speakerId != null) { accounts.speakers += 1; return; }
    if (account.approvalSource === 'admin') return;
    accounts.needGrant += 1;
    const stored = (await db.collection(GRANTS).doc(doc.id).get()).data() ?? null;
    const current = revision !== null && stored?.policyRevision === revision ? stored : null;
    if (current) accounts.currentGrant += 1;
    // The grant in place after the next sweep. A sweep writes the projected
    // grant, so a cached one does not count; a resumed sweep skips accounts at
    // or before its cursor (uids are ASCII, so this order is Firestore's), and
    // those keep the stored grant. Without a policy, the stored grant decides.
    const resumed = control?.candidateRevision === revision && typeof control.cursor === 'string' && doc.id <= control.cursor;
    const next = policy && !resumed ? deriveTicketResourceGrant({ policy, context,
      tickets: claimed.get(doc.id) ?? [], uid: doc.id, registration: account }) : current;
    if (policy && !coversSessions(next, canonical)) accounts.projectedNoSessions += 1;
    if (sourceName !== 'missing') return;
    missing.count += 1;
    if (current) missing.currentGrant += 1;
    if (coversSessions(next, canonical)) missing.usable += 1;
    else missing.unresolvedUids.push(doc.id);
  });

  return {
    control: control && { effectiveRevision: control.effectiveRevision ?? null, candidateRevision: control.candidateRevision ?? null },
    scope: { provider: context.provider, eventId: context.eventId },
    candidateRevision: revision,
    policy: { source, issues },
    tickets,
    accounts: { ...accounts, missingApprovalSource: missing },
    // Coordinator condition, Nov. 15, 2026 (#1008).
    activationReady: missing.unresolvedUids.length === 0,
  };
}

/**
 * Hand recomputeEntitlement a db whose transactions record each write path.
 * With apply the write goes through; without it the transaction is read-only
 * and the write is dropped. The derivation itself is unchanged.
 */
function observedDb(db, apply) {
  const observed = { db: null, writes: [] };
  observed.db = {
    collection: (name) => db.collection(name),
    runTransaction: (fn) => db.runTransaction((tx) => {
      observed.writes = []; // A retried attempt starts over.
      const proxy = { get: (target) => tx.get(target) };
      for (const op of ['set', 'update', 'delete', 'create']) {
        proxy[op] = (ref, ...rest) => {
          observed.writes.push(ref.path);
          if (apply) tx[op](ref, ...rest);
          return proxy;
        };
      }
      return fn(proxy);
    }, apply ? undefined : { readOnly: true }),
  };
  return observed;
}

async function backfillTicketGrants({ db, env = process.env, apply = false, now = () => new Date() }) {
  const before = await readControl(db);
  const revision = stagedRevision(before);
  if (revision === null) {
    throw new Error('No ticket resource policy revision is staged or effective. Nothing to derive.');
  }
  // recomputeEntitlement clears a grant it cannot derive. A wrong ticketing
  // scope in this shell would clear every grant, so check the scope first.
  if (!(await readTicketResourcePolicy({ db, tx: READER, env }))?.policy) {
    throw new Error('The stored policy revision does not validate for this ticketing provider and event. Check EVENT_TICKETING_PROVIDER and EVENT_TICKETING_EVENT_ID.');
  }
  const totals = { accounts: 0, unchanged: 0, held: 0, grantWrites: 0, accountWrites: 0, invalid: 0 };
  const invalidUids = [];
  const observed = observedDb(db, apply);
  let failedUid = null;
  const recompute = async (doc) => {
    failedUid = doc.id;
    const result = await recomputeEntitlement({ db: observed.db, uid: doc.id, env, now });
    failedUid = null;
    if (result.action === 'missing') return; // Deleted between the page read and the transaction.
    totals.accounts += 1;
    if (result.action === 'unchanged') totals.unchanged += 1;
    if (result.action === 'held') totals.held += 1;
    if (observed.writes.some((path) => path.startsWith(`${GRANTS}/`))) totals.grantWrites += 1;
    if (observed.writes.some((path) => path.startsWith('users/'))) totals.accountWrites += 1;
    if (result.grantStatus === 'invalid') { totals.invalid += 1; invalidUids.push(doc.id); }
  };
  try {
    await eachDoc(db, 'users', recompute);
  } catch (error) {
    // Each account commits on its own: the receipt keeps what the run already did.
    throw Object.assign(error, { result: { mode: apply ? 'apply' : 'dry-run', revision, totals, invalidUids, failedUid } });
  }
  return { mode: apply ? 'apply' : 'dry-run', revision,
    control: { before: brief(before), after: brief(await readControl(db)) }, totals, invalidUids };
}

const brief = (control) => control && { effectiveRevision: control.effectiveRevision ?? null,
  candidateRevision: control.candidateRevision ?? null };

/**
 * Operator boundary for publishTicketAccessPolicy: the caller holds the
 * project's operator credentials. It refuses a stale expected revision, an
 * invalid policy and a failed activation condition before anything is
 * written. A dry run stops there. --apply runs the helper (stage, sweep,
 * publish) and reads the control document back.
 */
async function publishPolicy({ db, env = process.env, policyInput, expectedRevision, apply = false, now = () => new Date() }) {
  if (policyInput === undefined) throw new Error('publish needs --policy <file>.');
  const control = await readControl(db);
  const effective = control?.effectiveRevision ?? 0;
  const candidate = control?.candidateRevision ?? null;
  const revision = policyInput?.revision;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== effective) {
    throw new Error(`--expected-revision must equal the current effective revision (${effective}).`);
  }
  // The helper's staging rules, checked before a dry run can pass.
  if (candidate !== null && candidate !== revision) {
    throw new Error(`Revision ${candidate} is being recomputed. Resume it with its own policy file.`);
  }
  if (candidate === null && !(Number.isSafeInteger(revision) && revision > effective)) {
    throw new Error(`Use a policy revision above the effective revision (${effective}).`);
  }
  const inventory = await inventoryTicketGrants({ db, env, policyInput });
  const result = { mode: apply ? 'apply' : 'dry-run', expectedRevision, revision: inventory.candidateRevision,
    checks: { policyIssues: inventory.policy.issues, activationReady: inventory.activationReady,
      unresolvedUids: inventory.accounts.missingApprovalSource.unresolvedUids,
      projectedNoSessions: inventory.accounts.projectedNoSessions, unmappedClassIds: inventory.tickets.unmappedClassIds } };
  if (inventory.policy.issues.length > 0) throw Object.assign(new Error('The policy file is not valid for this deployment.'), { result });
  if (!inventory.activationReady) {
    throw Object.assign(new Error('Approved accounts with no approvalSource have no grant that covers a session.'), { result });
  }
  if (!apply) return result;
  try {
    // The same parsed policy that passed the checks above.
    result.sweep = await publishTicketAccessPolicy({ db, policy: structuredClone(policyInput), expectedRevision, env, now });
  } catch (error) {
    // Best effort: the same outage must not replace the helper's error and progress.
    result.readback = await readControl(db).then(brief, () => 'unavailable');
    throw Object.assign(error, { result });
  }
  result.readback = brief(await readControl(db));
  return result;
}

const LEGACY = Object.freeze({ effectiveRevision: 0, candidateRevision: null, cursor: null, processed: 0, remaining: 0 });

/**
 * Rollback: set the control document to effective revision 0, which every
 * check treats as legacy. Nothing is published and stored revisions stay.
 * A project with no control document is already legacy and is not written.
 */
async function returnToLegacy({ db, apply = false, now = () => new Date() }) {
  const before = await readControl(db);
  if (apply && before) await db.collection(POLICIES).doc('current').set({ ...LEGACY, updatedAt: now() });
  const after = apply ? await readControl(db) : before;
  return { mode: apply ? 'apply' : 'dry-run', before: brief(before), after: brief(after),
    legacy: !after || after.effectiveRevision === 0 };
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

/** CLI body; returns the exit code. Receipts and reports never overwrite a file. */
async function run({ db, projectId, env = process.env, argv, now = () => new Date(), stdout = console.log }) {
  const [command] = argv;
  const apply = argv.includes('--apply');
  const policyPath = option(argv, '--policy');
  // Read once: the checks and the publication use this one parsed copy.
  const policyInput = policyPath === undefined ? undefined : JSON.parse(readFileSync(policyPath, 'utf8'));
  if (command === 'inventory') {
    const report = { projectId, readAt: now().toISOString(),
      ...await inventoryTicketGrants({ db, env, policyInput }) };
    const out = option(argv, '--out');
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    else stdout(JSON.stringify(report, null, 2));
    return report.activationReady && report.policy.issues.length === 0 ? 0 : 2;
  }
  const commands = {
    backfill: () => backfillTicketGrants({ db, env, apply, now }),
    publish: () => publishPolicy({ db, env, apply, now, policyInput,
      expectedRevision: Number(option(argv, '--expected-revision')) }),
    legacy: () => returnToLegacy({ db, apply, now }),
  };
  if (!commands[command]) throw new Error('Use: ticket-grants.cjs inventory|backfill|publish|legacy (see the file header).');
  const receiptPath = option(argv, '--receipt');
  if (!receiptPath) throw new Error(`${command} needs --receipt <new-file>.`);
  writeFileSync(receiptPath, '', { flag: 'wx' }); // Claim the file before any write to the project.
  const startedAt = now().toISOString();
  let receipt;
  try {
    receipt = { projectId, command, startedAt, ...await commands[command]() };
  } catch (error) {
    receipt = { projectId, command, startedAt, mode: apply ? 'apply' : 'dry-run', ...error.result,
      error: error.message, ...(error.progress ? { progress: error.progress } : {}) };
  }
  receipt.finishedAt = now().toISOString();
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  stdout(JSON.stringify({ receipt: receiptPath, command, mode: receipt.mode, error: receipt.error ?? null }));
  return receipt.error || receipt.totals?.invalid > 0 ? 1 : 0;
}

if (require.main === module) {
  const { initFirebase } = require('./lib/firebase-init.cjs');
  const { db, projectId } = initFirebase();
  run({ db, projectId, argv: process.argv.slice(2) })
    .then((code) => { process.exitCode = code; })
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { inventoryTicketGrants, backfillTicketGrants, publishPolicy, returnToLegacy, run };
