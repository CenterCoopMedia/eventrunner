// Run inside the existing Firestore emulator job. This covers the real Admin
// SDK increment/merge/query contract, then the browser's denial of that data.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
const require = createRequire(import.meta.url);
const telemetry = require('../functions/src/telemetry/webVitals.cjs');
const maintenance = require('../functions/src/maintenance/cleanup.cjs');
const reporting = require('../scripts/report-web-vitals.cjs');

const projectId = 'demo-field-vitals';
let environment;
let app;
let db;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run this test through the Firestore emulator job.');
  environment = await initializeTestEnvironment({ projectId,
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  await environment.clearFirestore();
  app = initializeApp({ projectId }, 'field-vitals-contract');
  db = getFirestore(app);
});
afterAll(async () => {
  if (app) await deleteApp(app);
  if (environment) await environment.cleanup();
});

it('persists atomic daily counts, reports only current rows, honors opt-out and expires the rows', async () => {
  const now = Date.UTC(2026, 10, 12, 16);
  await db.doc('config/features').set({ coreWebVitals: true });
  const recorder = telemetry.createVitalsRecorder({ db, now: () => now,
    wait: async () => {} }); // Advance the batching clock without a real one-second wait.
  const sample = { route: '/attendees/:uid', device: 'mobile', name: 'LCP', value: 2500 };
  await Promise.all([
    recorder.record(sample), recorder.record({ ...sample, value: 2499 }),
    recorder.record({ ...sample, name: 'INP', value: 200 }),
  ]);
  await recorder.record(sample);
  const snapshot = await db.collection('web_vitals_daily').get();
  expect(snapshot.size).toBe(1);
  const row = snapshot.docs[0].data();
  expect(Object.keys(row).sort()).toEqual(['counts', 'day', 'device', 'expiresAt', 'route']);
  expect(row.counts).toEqual({ LCP: { 25: 3 }, INP: { 20: 1 } });
  expect(row.day).toBe('2026-11-12');
  expect(row.expiresAt.toDate().toISOString()).toBe('2026-12-12T00:00:00.000Z');

  const current = await reporting.readProject(projectId, () => now);
  expect(current).toHaveLength(1);
  expect(reporting.formatReport(current)).toContain('/attendees/:uid\tmobile\tLCP\t3\t2500 ms\t<= 2500 ms\tgood');
  expect(await reporting.readProject(projectId, () => Date.UTC(2026, 11, 13))).toEqual([]);

  const browser = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(browser, snapshot.docs[0].ref.path)));
  await assertFails(getDocs(collection(browser, 'web_vitals_daily')));
  await assertFails(setDoc(doc(browser, 'web_vitals_daily/forged'), { ...row, expiresAt: row.expiresAt.toDate() }));

  await db.doc('config/features').set({ coreWebVitals: false });
  expect(await recorder.record(sample)).toEqual({ stored: false });
  expect((await snapshot.docs[0].ref.get()).data().counts.LCP).toEqual({ 25: 3 });
  expect(await maintenance.sweepExpiredWebVitals({ db, now: () => Date.UTC(2026, 11, 13) }))
    .toEqual({ deleted: 1 });
  expect((await db.collection('web_vitals_daily').get()).empty).toBe(true);
});
