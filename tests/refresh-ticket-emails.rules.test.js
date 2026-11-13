// Operator refresh against the real Firestore emulator: dry-run, edit
// protection, exact two-document scope and content-idempotent reruns.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { refreshTicketEmails } = require('../scripts/refresh-ticket-emails.cjs');
const { getDefaultTemplate } = require('../functions/src/email/templates.cjs');
const { SEED_ACTOR } = require('shared/seed');
const PROJECT_ID = 'demo-run-of-show';
const NOW = Date.parse('2026-11-13T14:00:00Z');
let testEnv;
let adminApp;
let db;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `ticket-email-refresh-${process.pid}`);
  db = getFirestore(adminApp);
});
beforeEach(async () => { await testEnv.clearFirestore(); });
afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

it('dry-runs without writes, refreshes the two seed-owned copies and leaves a second apply unchanged', async () => {
  for (const id of ['ticket.get_ticket', 'ticket.claim_prompt']) {
    await db.collection('email_templates').doc(id).set({
      subject: 'Seed copy', html: '<p>Seed copy</p>', text: 'Seed copy',
      seeded: true, updatedBy: SEED_ACTOR.email, seededAt: '2026-01-01',
    });
  }
  const before = (await db.collection('email_templates').get()).docs.map((doc) => doc.data());
  expect(await refreshTicketEmails({ db })).toEqual([
    { id: 'ticket.get_ticket', status: 'would-refresh' }, { id: 'ticket.claim_prompt', status: 'would-refresh' },
  ]);
  expect((await db.collection('email_templates').get()).docs.map((doc) => doc.data())).toEqual(before);
  expect((await refreshTicketEmails({ db, dryRun: false, now: () => NOW })).map((row) => row.status)).toEqual(['refreshed', 'refreshed']);
  for (const id of ['ticket.get_ticket', 'ticket.claim_prompt']) {
    const saved = (await db.collection('email_templates').doc(id).get()).data();
    const template = getDefaultTemplate(id);
    expect(saved).toMatchObject({ subject: template.subject, html: template.html, text: template.text, seeded: true, updatedBy: SEED_ACTOR.email, seededAt: '2026-01-01' });
    expect(saved.updatedAt.toMillis()).toBe(NOW);
  }
  expect((await refreshTicketEmails({ db, dryRun: false, now: () => NOW + 1000 })).map((row) => row.status)).toEqual(['current', 'current']);
  expect((await db.collection('email_templates').doc('ticket.get_ticket').get()).data().updatedAt.toMillis()).toBe(NOW);
});

it.each([
  { seeded: false, updatedBy: SEED_ACTOR.email },
  { seeded: true, updatedBy: 'staff@example.test' },
  { seeded: true },
])('preserves edited or unverified ownership: %j', async (ownership) => {
  const saved = { ...ownership, subject: 'Staff copy', html: '<p>Staff copy</p>', text: 'Staff copy' };
  await db.collection('email_templates').doc('ticket.get_ticket').set(saved);
  await db.collection('email_templates').doc('speaker.invite').set(saved);
  await db.collection('config').doc('event').set({ name: 'Keep this event' });
  expect(await refreshTicketEmails({ db, dryRun: false })).toEqual([
    { id: 'ticket.get_ticket', status: 'edited' }, { id: 'ticket.claim_prompt', status: 'absent' },
  ]);
  expect((await db.collection('email_templates').doc('ticket.get_ticket').get()).data()).toEqual(saved);
  expect((await db.collection('email_templates').doc('speaker.invite').get()).data()).toEqual(saved);
  expect((await db.collection('email_templates').doc('ticket.claim_prompt').get()).exists).toBe(false);
  expect((await db.collection('config').doc('event').get()).data()).toEqual({ name: 'Keep this event' });
});
