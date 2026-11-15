// Ticket grant inventory and backfill against the Firestore emulator (#1008); synthetic data only.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const POLICY = require('../functions/src/ticketing/__fixtures__/resource-policy.json');
const { publishTicketAccessPolicy } = require('../functions/src/ticketing/resourceGrants.cjs');
const { inventoryTicketGrants, backfillTicketGrants, run } = require('../scripts/ticket-grants.cjs');
const ENV = { EVENT_TICKETING_PROVIDER: 'manual', EVENT_TICKETING_EVENT_ID: POLICY.eventId };
const PROJECT = 'demo-ticket-grant-migration';
const dir = mkdtempSync(join(tmpdir(), 'ticket-grants-'));
const policyFile = join(dir, 'policy.json');
writeFileSync(policyFile, JSON.stringify(POLICY));
let testEnv;
let app;
let db;

const ticket = (id, fields) => db.collection('tickets').doc(id).set({ externalId: id, provider: 'manual',
  eventId: POLICY.eventId, status: 'valid', claimedByUid: null, ...fields });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId: PROJECT }, `ticket-grant-migration-${process.pid}`);
  db = getFirestore(app);
});
beforeEach(async () => {
  await testEnv.clearFirestore();
  await db.collection('config').doc('event').set({ days: [{ id: 'friday' }, { id: 'saturday' }] });
  await db.collection('config').doc('features').set({ autoApproveTicketHolders: true });
  await db.collection('cmsSchedule').doc('keynote').set({ dayId: 'friday' });
  await db.collection('cmsSchedule').doc('workshop').set({ dayId: 'saturday' });
  await db.collection('users').doc('paid').set({ registrationStatus: 'approved', approvalSource: 'ticket', speakerId: null });
  // Approved before approvalSource existed: no field at all.
  await db.collection('users').doc('legacy').set({ registrationStatus: 'approved', speakerId: null });
  await db.collection('users').doc('staffpick').set({ registrationStatus: 'approved', approvalSource: 'admin', speakerId: null });
  await db.collection('users').doc('speaker').set({ registrationStatus: 'approved', approvalSource: 'ticket', speakerId: 's1' });
  await db.collection('users').doc('waiting').set({ registrationStatus: 'pending', approvalSource: null, speakerId: null });
  await ticket('t-paid', { ticketClassId: 'day-pass', claimedByUid: 'paid' });
  await ticket('t-legacy', { claimedByUid: 'legacy' });
  await ticket('t-speaker', { ticketClassId: 'vip', claimedByUid: 'speaker' });
  await ticket('t-other', { ticketClassId: 'day-pass', eventId: 'other-event' });
  await ticket('t-refunded', { ticketClassId: 'day-pass', status: 'refunded' });
});
afterAll(async () => {
  await testEnv?.cleanup();
  if (app) await deleteApp(app);
});

it('inventory counts classes, approval sources and the missing-approvalSource accounts before publication', async () => {
  const report = await inventoryTicketGrants({ db, env: ENV, policyInput: structuredClone(POLICY) });
  expect(report.control).toBeNull();
  expect(report.candidateRevision).toBe(1);
  expect(report.policy).toEqual({ source: 'file', issues: [] });
  expect(report.tickets).toEqual({ total: 5, noClassId: 1, otherScope: 1, unmappedClassIds: ['vip'],
    byClass: [{ classId: 'day-pass', total: 2, valid: 1 }, { classId: 'vip', total: 1, valid: 1 }] });
  expect(report.accounts).toEqual({ approved: 4, byApprovalSource: { ticket: 2, missing: 1, admin: 1 },
    speakers: 1, needGrant: 2, currentGrant: 0, projectedNoSessions: 1,
    missingApprovalSource: { count: 1, currentGrant: 0, usable: 0, unresolvedUids: ['legacy'] } });
  expect(report.activationReady).toBe(false);
  expect((await db.collection('ticket_access_policies').get()).size).toBe(0);
  expect((await db.collection('ticket_access_grants').get()).size).toBe(0);
});

it('backfill refuses without a staged revision and still writes its receipt', async () => {
  await expect(backfillTicketGrants({ db, env: ENV })).rejects.toThrow(/No ticket resource policy revision/);
  const receipt = join(dir, 'no-revision.json');
  const lines = [];
  expect(await run({ db, projectId: PROJECT, env: ENV, argv: ['backfill', '--receipt', receipt], stdout: (line) => lines.push(line) })).toBe(1);
  expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({ projectId: PROJECT, mode: 'dry-run', error: expect.stringMatching(/No ticket resource policy revision/) });
  expect((await db.collection('ticket_access_grants').get()).size).toBe(0);
});

it('backfill refuses a ticketing scope that does not match the stored revision', async () => {
  await publishTicketAccessPolicy({ db, policy: structuredClone(POLICY), expectedRevision: 0, env: ENV });
  const before = (await db.collection('ticket_access_grants').get()).size;
  await expect(backfillTicketGrants({ db, env: { ...ENV, EVENT_TICKETING_EVENT_ID: 'other-event' }, apply: true }))
    .rejects.toThrow(/does not validate/);
  expect((await db.collection('ticket_access_grants').get()).size).toBe(before);
});

it('after a class-ID import the dry run writes nothing, apply grants once, and a repeat writes nothing', async () => {
  await publishTicketAccessPolicy({ db, policy: structuredClone(POLICY), expectedRevision: 0, env: ENV });
  const published = await inventoryTicketGrants({ db, env: ENV });
  expect(published.control).toEqual({ effectiveRevision: 1, candidateRevision: null });
  expect(published.policy.source).toBe('stored');
  expect(published.accounts.currentGrant).toBe(2);
  // The sweep granted the legacy account, but its ticket has no class ID: no sessions.
  expect(published.accounts.missingApprovalSource).toEqual({ count: 1, currentGrant: 1, usable: 0, unresolvedUids: ['legacy'] });
  expect(published.activationReady).toBe(false);

  // An approved import supplies the class ID (no trigger runs in this test).
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  const stale = (await db.collection('ticket_access_grants').doc('legacy').get()).data();
  expect(stale.classIds).toEqual([]);

  const dry = await backfillTicketGrants({ db, env: ENV });
  expect(dry).toMatchObject({ mode: 'dry-run', revision: 1, invalidUids: [],
    totals: { accounts: 5, unchanged: 4, held: 0, grantWrites: 1, accountWrites: 0, invalid: 0 } });
  expect((await db.collection('ticket_access_grants').doc('legacy').get()).data()).toEqual(stale);

  const receipt = join(dir, 'apply.json');
  expect(await run({ db, projectId: PROJECT, env: ENV, argv: ['backfill', '--apply', '--receipt', receipt], stdout: () => {} })).toBe(0);
  expect(JSON.parse(readFileSync(receipt, 'utf8'))).toMatchObject({ projectId: PROJECT, mode: 'apply', revision: 1,
    control: { before: { effectiveRevision: 1, candidateRevision: null }, after: { effectiveRevision: 1, candidateRevision: null } },
    totals: { accounts: 5, grantWrites: 1, accountWrites: 0, invalid: 0 } });
  const granted = (await db.collection('ticket_access_grants').doc('legacy').get()).data();
  expect(granted.classIds).toEqual(['day']);
  expect(granted.resources.sessions).toEqual({ all: false, dayIds: ['friday'], sessionIds: [] });

  const again = await backfillTicketGrants({ db, env: ENV, apply: true });
  expect(again.totals).toEqual({ accounts: 5, unchanged: 5, held: 0, grantWrites: 0, accountWrites: 0, invalid: 0 });
  // A receipt never overwrites an earlier one.
  await expect(run({ db, projectId: PROJECT, env: ENV, argv: ['backfill', '--receipt', receipt], stdout: () => {} })).rejects.toThrow(/EEXIST/);

  const ready = await inventoryTicketGrants({ db, env: ENV });
  expect(ready.accounts.missingApprovalSource).toEqual({ count: 1, currentGrant: 1, usable: 1, unresolvedUids: [] });
  expect(ready.activationReady).toBe(true);
});

const receiptOf = async (name, argv) => {
  const path = join(dir, `${name}.json`);
  const code = await run({ db, projectId: PROJECT, env: ENV, argv: [...argv, '--receipt', path], stdout: () => {} });
  return { code, receipt: JSON.parse(readFileSync(path, 'utf8')) };
};
const policies = async () => (await db.collection('ticket_access_policies').get()).docs.map((doc) => doc.id).sort();

it('publish refuses a stale expected revision and an unresolved account, and its dry run writes nothing', async () => {
  const stale = await receiptOf('publish-stale', ['publish', '--policy', policyFile, '--expected-revision', '1', '--apply']);
  expect(stale.code).toBe(1);
  expect(stale.receipt.error).toMatch(/must equal the current effective revision \(0\)/);

  const unresolved = await receiptOf('publish-unresolved', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply']);
  expect(unresolved.code).toBe(1);
  expect(unresolved.receipt).toMatchObject({ mode: 'apply', revision: 1,
    error: expect.stringMatching(/no approvalSource/),
    checks: { activationReady: false, unresolvedUids: ['legacy'], projectedNoSessions: 1, unmappedClassIds: ['vip'] } });
  expect(await policies()).toEqual([]);

  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  const dry = await receiptOf('publish-dry', ['publish', '--policy', policyFile, '--expected-revision', '0']);
  expect(dry.code).toBe(0);
  expect(dry.receipt).toMatchObject({ mode: 'dry-run', revision: 1, checks: { activationReady: true, unresolvedUids: [] } });
  expect(dry.receipt.sweep).toBeUndefined();
  expect(await policies()).toEqual([]);
  expect((await db.collection('ticket_access_grants').get()).size).toBe(0);
});

it('publish applies and reads back; legacy rolls back without publishing; the revision can be published again', async () => {
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  const published = await receiptOf('publish-apply', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply']);
  expect(published.code).toBe(0);
  expect(published.receipt).toMatchObject({ mode: 'apply', revision: 1,
    sweep: { revision: 1, processed: 5, remaining: 0, complete: true },
    readback: { effectiveRevision: 1, candidateRevision: null } });
  expect((await db.collection('ticket_access_grants').doc('legacy').get()).data().classIds).toEqual(['day']);

  const dry = await receiptOf('legacy-dry', ['legacy']);
  expect(dry.receipt).toMatchObject({ mode: 'dry-run', legacy: false, after: { effectiveRevision: 1, candidateRevision: null } });

  const rolledBack = await receiptOf('legacy-apply', ['legacy', '--apply']);
  expect(rolledBack.code).toBe(0);
  expect(rolledBack.receipt).toMatchObject({ mode: 'apply', legacy: true,
    before: { effectiveRevision: 1, candidateRevision: null }, after: { effectiveRevision: 0, candidateRevision: null } });
  const { updatedAt, ...state } = (await db.collection('ticket_access_policies').doc('current').get()).data();
  expect(updatedAt).toBeDefined();
  expect(state).toEqual({ effectiveRevision: 0, candidateRevision: null, cursor: null, processed: 0, remaining: 0 });
  expect(await policies()).toEqual(['current', 'revision-1']);
  // The rollback state reads as legacy, not as a broken policy.
  const afterRollback = await inventoryTicketGrants({ db, env: ENV });
  expect(afterRollback.policy).toEqual({ source: 'none', issues: [] });
  expect(afterRollback.candidateRevision).toBeNull();
  // A different policy cannot take the stored revision's number.
  const changed = structuredClone(POLICY);
  changed.mappings = changed.mappings.slice(1);
  expect((await inventoryTicketGrants({ db, env: ENV, policyInput: changed })).policy.issues)
    .toEqual([{ path: 'policy', message: 'The policy differs from the stored revision with the same number.' }]);

  expect((await receiptOf('republish-stale', ['publish', '--policy', policyFile, '--expected-revision', '1', '--apply'])).code).toBe(1);
  const again = await receiptOf('republish', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply']);
  expect(again.code).toBe(0);
  expect(again.receipt.readback).toEqual({ effectiveRevision: 1, candidateRevision: null });
});

it('legacy does not create a control document on a project that never published', async () => {
  const result = await receiptOf('legacy-none', ['legacy', '--apply']);
  expect(result.receipt).toMatchObject({ mode: 'apply', before: null, after: null, legacy: true });
  expect(await policies()).toEqual([]);
});

it('readiness uses the grant the sweep will write, not a cached one', async () => {
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  expect((await receiptOf('f1-publish', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply'])).code).toBe(0);
  expect((await receiptOf('f1-legacy', ['legacy', '--apply'])).code).toBe(0);
  // The cached revision-1 grant still covers Friday, but the ticket's class is now unmapped.
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'vip' });
  const report = await inventoryTicketGrants({ db, env: ENV, policyInput: structuredClone(POLICY) });
  expect(report.accounts.missingApprovalSource).toEqual({ count: 1, currentGrant: 1, usable: 0, unresolvedUids: ['legacy'] });
  const refused = await receiptOf('f1-republish', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply']);
  expect(refused.code).toBe(1);
  expect(refused.receipt.checks.unresolvedUids).toEqual(['legacy']);
  expect((await db.collection('ticket_access_policies').doc('current').get()).data().effectiveRevision).toBe(0);
});

it('a day grant covers nothing when that day has no session', async () => {
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  await db.collection('cmsSchedule').doc('keynote').delete(); // Friday's only session.
  const report = await inventoryTicketGrants({ db, env: ENV, policyInput: structuredClone(POLICY) });
  expect(report.accounts.projectedNoSessions).toBe(2);
  expect(report.accounts.missingApprovalSource.unresolvedUids).toEqual(['legacy']);
  expect(report.activationReady).toBe(false);
});

it('an unfinished sweep resumes after a referenced session is deleted', async () => {
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  expect((await receiptOf('f3-publish', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply'])).code).toBe(0);
  // The state a stopped first sweep leaves: revision 1 staged, effective still 0.
  await db.collection('ticket_access_policies').doc('current').set({ effectiveRevision: 0, candidateRevision: 1,
    cursor: null, processed: 0, remaining: 5 });
  await db.collection('cmsSchedule').doc('workshop').delete(); // The workshop class names it.
  const resumed = await receiptOf('f3-resume', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply']);
  expect(resumed.receipt.error).toBeUndefined();
  expect(resumed.code).toBe(0);
  expect(resumed.receipt.readback).toEqual({ effectiveRevision: 1, candidateRevision: null });

  const changed = structuredClone(POLICY);
  changed.mappings = changed.mappings.slice(1);
  await db.collection('ticket_access_policies').doc('current').update({ effectiveRevision: 0, candidateRevision: 1 });
  const report = await inventoryTicketGrants({ db, env: ENV, policyInput: changed });
  expect(report.policy.issues).toEqual([{ path: 'policy', message: 'The policy differs from the stored revision with the same number.' }]);
});

it('publish dry run refuses what the helper would refuse: another staged revision or a revision not above the effective one', async () => {
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  expect((await receiptOf('f6-publish', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply'])).code).toBe(0);
  const same = await receiptOf('f6-same', ['publish', '--policy', policyFile, '--expected-revision', '1']);
  expect(same.receipt.error).toMatch(/above the effective revision \(1\)/);
  await db.collection('ticket_access_policies').doc('current').update({ candidateRevision: 2 });
  const third = { ...structuredClone(POLICY), revision: 3 };
  const thirdFile = join(dir, 'policy-3.json');
  writeFileSync(thirdFile, JSON.stringify(third));
  const busy = await receiptOf('f6-busy', ['publish', '--policy', thirdFile, '--expected-revision', '1']);
  expect(busy.code).toBe(1);
  expect(busy.receipt.error).toMatch(/Revision 2 is being recomputed/);
});

it('an all-sessions grant covers nothing when the event has no sessions', async () => {
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  await db.collection('cmsSchedule').doc('keynote').delete();
  await db.collection('cmsSchedule').doc('workshop').delete();
  const policy = structuredClone(POLICY);
  policy.classes[0].resources.sessions = { all: true, dayIds: [], sessionIds: [] };
  policy.classes[1].resources.sessions = { all: false, dayIds: [], sessionIds: [] };
  const report = await inventoryTicketGrants({ db, env: ENV, policyInput: policy });
  expect(report.policy.issues).toEqual([]);
  expect(report.accounts.missingApprovalSource.unresolvedUids).toEqual(['legacy']);
  expect(report.activationReady).toBe(false);
});

it('a backfill that fails part way keeps the totals of the accounts it already wrote', async () => {
  await publishTicketAccessPolicy({ db, policy: structuredClone(POLICY), expectedRevision: 0, env: ENV });
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  let calls = 0;
  // The second account transaction fails as an unavailable backend would.
  const flaky = { collection: (name) => db.collection(name),
    runTransaction: (fn, options) => (++calls === 2 ? Promise.reject(new Error('14 UNAVAILABLE')) : db.runTransaction(fn, options)) };
  const path = join(dir, 'partial.json');
  expect(await run({ db: flaky, projectId: PROJECT, env: ENV, argv: ['backfill', '--apply', '--receipt', path], stdout: () => {} })).toBe(1);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ mode: 'apply', revision: 1, error: '14 UNAVAILABLE', failedUid: 'paid',
    totals: { accounts: 1, grantWrites: 1, accountWrites: 0, invalid: 0 } });
  expect((await db.collection('ticket_access_grants').doc('legacy').get()).data().classIds).toEqual(['day']);
});

it('a resumed sweep keeps the stored grant of accounts before its cursor, so readiness uses that grant', async () => {
  await publishTicketAccessPolicy({ db, policy: structuredClone(POLICY), expectedRevision: 0, env: ENV });
  // A first sweep stopped after 'legacy' (first by uid) and wrote its empty grant.
  await db.collection('ticket_access_policies').doc('current').set({ effectiveRevision: 0, candidateRevision: 1,
    cursor: 'legacy', processed: 1, remaining: 4 });
  // The class ID arrives, but the ticket trigger has not run.
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  const report = await inventoryTicketGrants({ db, env: ENV, policyInput: structuredClone(POLICY) });
  expect(report.accounts.missingApprovalSource.unresolvedUids).toEqual(['legacy']);
  expect((await receiptOf('f7-refused', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply'])).code).toBe(1);

  expect((await receiptOf('f7-backfill', ['backfill', '--apply'])).code).toBe(0);
  const resumed = await receiptOf('f7-resume', ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply']);
  expect(resumed.code).toBe(0);
  expect(resumed.receipt.readback).toEqual({ effectiveRevision: 1, candidateRevision: null });
  expect((await db.collection('ticket_access_grants').doc('legacy').get()).data().classIds).toEqual(['day']);
});

it('a failed publication keeps its error and progress when the readback fails too', async () => {
  await db.collection('tickets').doc('t-legacy').update({ ticketClassId: 'general' });
  let calls = 0;
  let down = false;
  const unavailable = () => Promise.reject(new Error('14 UNAVAILABLE'));
  // The backend goes away during the sweep and stays away for the readback.
  const flaky = {
    collection: (name) => (down ? { doc: () => ({ get: unavailable }) } : db.collection(name)),
    runTransaction: (fn, options) => {
      if (++calls === 2) { down = true; return unavailable(); }
      return db.runTransaction(fn, options);
    },
  };
  const path = join(dir, 'publish-outage.json');
  expect(await run({ db: flaky, projectId: PROJECT, env: ENV, argv: ['publish', '--policy', policyFile, '--expected-revision', '0', '--apply', '--receipt', path], stdout: () => {} })).toBe(1);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ mode: 'apply', revision: 1, error: '14 UNAVAILABLE',
    readback: 'unavailable', checks: { activationReady: true },
    progress: { revision: 1, processed: 0, remaining: 5, complete: false } });
});
