import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Bytes, collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, it } from 'vitest';

const EMAIL = 'screenshot-staff@example.test';
const PROJECT = 'demo-run-of-show';
const BYTES = new Uint8Array([1, 2, 3, 4]);
const OBJECT = 'request_screenshots/feedback-screenshot-fixture-0';
let site;
let consoleEnv;

beforeAll(async () => {
  site = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
  consoleEnv = await initializeTestEnvironment({
    projectId: 'demo-eventrunner-console-screenshots',
    firestore: { rules: readFileSync('console/firestore.rules', 'utf8') },
  });
  await site.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'config/bootstrap'), { adminEmails: [EMAIL] });
    await setDoc(doc(db, 'feedback/screenshot-fixture'), { screenshotDigests: ['digest'] });
    await setDoc(doc(db, OBJECT), { image: Bytes.fromUint8Array(BYTES) });
    await uploadBytes(ref(context.storage(), OBJECT), BYTES);
  });
  await consoleEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'console_config/operators'), { emails: [EMAIL] });
    await setDoc(doc(db, 'problem_report_receipts/screenshot-fixture'), { screenshotCount: 1 });
    await setDoc(doc(db, OBJECT), { image: Bytes.fromUint8Array(BYTES) });
  });
});

afterAll(async () => {
  await site?.cleanup();
  await consoleEnv?.cleanup();
});

it('staff can read feedback rows while the emulator denies direct screenshot reads, lists and writes', async () => {
  const staff = site.authenticatedContext('staff', { email: EMAIL, email_verified: true });
  await assertSucceeds(getDoc(doc(staff.firestore(), 'feedback/screenshot-fixture')));
  for (const context of [site.unauthenticatedContext(), site.authenticatedContext('attendee'), staff]) {
    const db = context.firestore();
    await assertFails(getDoc(doc(db, OBJECT)));
    await assertFails(getDocs(collection(db, 'request_screenshots')));
    await assertFails(setDoc(doc(db, OBJECT), { image: Bytes.fromUint8Array(BYTES) }));
    await assertFails(getBytes(ref(context.storage(), OBJECT)));
    await assertFails(uploadBytes(ref(context.storage(), OBJECT), BYTES));
  }
});

it('Console receipt and screenshot records are readable only through the Console handlers', async () => {
  for (const context of [
    consoleEnv.unauthenticatedContext(),
    consoleEnv.authenticatedContext('operator', { email: EMAIL, email_verified: true }),
  ]) {
    const db = context.firestore();
    await assertFails(getDoc(doc(db, 'problem_report_receipts/screenshot-fixture')));
    await assertFails(getDoc(doc(db, OBJECT)));
    await assertFails(setDoc(doc(db, OBJECT), { image: Bytes.fromUint8Array(BYTES) }));
  }
});
