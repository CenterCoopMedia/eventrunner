// Organization representatives (issue #334) against the real Firestore
// emulator. Two halves:
//
//   1. The rules: a grant and a queued edit are readable by staff and
//      operators only, and no client writes either, or an organization's
//      live or draft document. A representative cannot read its own grant,
//      its own edit, or another organization's.
//   2. The endpoints on the emulator, through the Admin SDK: a
//      representative of organization A who names organization B still
//      writes only A's queue, and is refused once revoked; a staff apply
//      writes the draft, never the live document.
//
// Authentication is the only fake.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const {
  createOwnOrganizationProfileHandler,
  createOrganizationRepresentativesHandler,
} = require('../functions/src/cms/organizationRepresentatives.cjs');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR_EMAIL = 'rep-operator@example.test';
const STAFF_EMAIL = 'rep-staff@example.test';
const T0 = Date.parse('2026-10-20T10:00:00.000Z');
const QUIET = { error() {}, warn() {}, info() {} };

const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR_EMAIL, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF_EMAIL, email_verified: true },
  repA: { uid: 'rep-a', email: 'rep-a@example.test', email_verified: true },
  repB: { uid: 'rep-b', email: 'rep-b@example.test', email_verified: true },
  stranger: { uid: 'user-1', email: 'someone@example.test', email_verified: true },
};
const ACCOUNTS = {
  'rep-a@example.test': { uid: 'rep-a', email: 'rep-a@example.test', emailVerified: true },
  'rep-b@example.test': { uid: 'rep-b', email: 'rep-b@example.test', emailVerified: true },
};
const auth = {
  async verifyIdToken(token) {
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
  async getUserByEmail(email) {
    if (!ACCOUNTS[email]) {
      const err = new Error('no user');
      err.code = 'auth/user-not-found';
      throw err;
    }
    return ACCOUNTS[email];
  },
};
const getConfig = async () => ({ bootstrap: { adminEmails: [OPERATOR_EMAIL], staffEmails: [STAFF_EMAIL] } });

let testEnv;
let adminApp;
let db;

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

const request = (token, body) => ({
  method: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

async function own(token, body) {
  const res = makeRes();
  await createOwnOrganizationProfileHandler({ db, auth, now: () => T0, log: QUIET })(request(token, body), res);
  return res;
}

async function staffCall(body, token = 'staff') {
  const res = makeRes();
  await createOrganizationRepresentativesHandler({ db, auth, getConfig, now: () => T0, log: QUIET })(
    request(token, body),
    res,
  );
  return res;
}

const client = (name) => {
  if (name === 'anon') return testEnv.unauthenticatedContext().firestore();
  const token = TOKENS[name];
  return testEnv.authenticatedContext(token.uid, { email: token.email, email_verified: true }).firestore();
};

async function seed() {
  await db.collection('config').doc('bootstrap').set({ adminEmails: [OPERATOR_EMAIL], staffEmails: [STAFF_EMAIL] });
  await db.collection('config').doc('event').set({ name: 'Example Event', historicalDemo: false });
  await db.collection('cmsOrganizations').doc('org-a').set({
    name: 'Org A', description: 'A live.', url: 'https://a.example.test/', tier: 'gold', order: 0, visible: true, revision: 1,
  });
  await db.collection('cmsOrganizations').doc('org-b').set({
    name: 'Org B', description: 'B live.', url: 'https://b.example.test/', tier: 'silver', order: 1, visible: true, revision: 1,
  });
  await db.collection('organization_representatives').doc('rep-a').set({
    uid: 'rep-a', email: 'rep-a@example.test', organizationId: 'org-a', grantedAt: new Date(T0), grantedBy: STAFF_EMAIL,
  });
  await db.collection('organization_representatives').doc('rep-b').set({
    uid: 'rep-b', email: 'rep-b@example.test', organizationId: 'org-b', grantedAt: new Date(T0), grantedBy: STAFF_EMAIL,
  });
  await db.collection('organization_edit_requests').doc('org-b').set({
    organizationId: 'org-b', fields: { description: 'B queued.' }, base: { description: 'B live.' },
    submittedByUid: 'rep-b', submittedByEmail: 'rep-b@example.test', submittedAt: new Date(T0),
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `organization-representatives-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('rules: grants and queued edits', () => {
  it('staff and operators read every grant and every queued edit', async () => {
    for (const name of ['staff', 'operator']) {
      const reader = client(name);
      await assertSucceeds(getDoc(doc(reader, 'organization_representatives/rep-a')));
      await assertSucceeds(getDocs(collection(reader, 'organization_representatives')));
      await assertSucceeds(getDoc(doc(reader, 'organization_edit_requests/org-b')));
      await assertSucceeds(getDocs(collection(reader, 'organization_edit_requests')));
    }
  });

  it('a representative cannot read its own grant or edit, nor another organization’s', async () => {
    const repA = client('repA');
    await assertFails(getDoc(doc(repA, 'organization_representatives/rep-a')));
    await assertFails(getDoc(doc(repA, 'organization_representatives/rep-b')));
    await assertFails(getDocs(query(collection(repA, 'organization_representatives'), where('uid', '==', 'rep-a'))));
    await assertFails(getDoc(doc(repA, 'organization_edit_requests/org-a')));
    await assertFails(getDoc(doc(repA, 'organization_edit_requests/org-b')));
    await assertFails(getDocs(collection(repA, 'organization_edit_requests')));
  });

  it('an attendee and an anonymous visitor read neither store', async () => {
    for (const name of ['stranger', 'anon']) {
      const reader = client(name);
      await assertFails(getDoc(doc(reader, 'organization_representatives/rep-a')));
      await assertFails(getDocs(collection(reader, 'organization_representatives')));
      await assertFails(getDoc(doc(reader, 'organization_edit_requests/org-b')));
    }
  });

  it('no client writes a grant or a queued edit, staff and representatives included', async () => {
    for (const name of ['operator', 'staff', 'repA', 'repB', 'stranger', 'anon']) {
      const writer = client(name);
      await assertFails(setDoc(doc(writer, 'organization_representatives/user-1'), { uid: 'user-1', organizationId: 'org-a' }));
      await assertFails(updateDoc(doc(writer, 'organization_representatives/rep-a'), { organizationId: 'org-b' }));
      await assertFails(deleteDoc(doc(writer, 'organization_representatives/rep-b')));
      await assertFails(setDoc(doc(writer, 'organization_edit_requests/org-a'), { fields: { description: 'x' } }));
      await assertFails(updateDoc(doc(writer, 'organization_edit_requests/org-b'), { fields: { description: 'x' } }));
      await assertFails(deleteDoc(doc(writer, 'organization_edit_requests/org-b')));
    }
  });

  it('a representative of A writes neither A’s nor B’s organization, live or draft', async () => {
    const repA = client('repA');
    for (const id of ['org-a', 'org-b']) {
      await assertFails(updateDoc(doc(repA, `cmsOrganizations/${id}`), { description: 'Mine now.' }));
      await assertFails(setDoc(doc(repA, `cmsOrganizations_drafts/${id}`), { description: 'Mine now.', status: 'dirty' }));
      await assertFails(getDoc(doc(repA, `cmsOrganizations_drafts/${id}`)));
    }
  });
});

describe('endpoints on the emulator', () => {
  it('a representative of A who names B writes only A’s queue; B is untouched', async () => {
    const res = await own('repA', {
      action: 'submit', organizationId: 'org-b', fields: { description: 'Written by A.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.organizationId).toBe('org-a');
    expect((await db.collection('organization_edit_requests').doc('org-a').get()).data().fields)
      .toEqual({ description: 'Written by A.' });
    expect((await db.collection('organization_edit_requests').doc('org-b').get()).data().fields)
      .toEqual({ description: 'B queued.' });
    expect((await db.collection('cmsOrganizations').doc('org-b').get()).data().description).toBe('B live.');
    expect((await db.collection('cmsOrganizations').doc('org-a').get()).data().description).toBe('A live.');
    expect((await db.collection('cmsOrganizations_drafts').doc('org-a').get()).exists).toBe(false);
  });

  it('a representative of A cannot change A’s tier or B’s anything, and cannot approve', async () => {
    const tier = await own('repA', { action: 'submit', fields: { tier: 'platinum' } });
    expect(tier.statusCode).toBe(400);
    const approve = await staffCall({ action: 'apply', organizationId: 'org-b' }, 'repA');
    expect(approve.statusCode).toBe(403);
    expect((await db.collection('cmsOrganizations_drafts').doc('org-b').get()).exists).toBe(false);
    expect((await db.collection('cmsOrganizations').doc('org-a').get()).data().tier).toBe('gold');
  });

  it('a revoked representative is refused, and its queued edit is gone', async () => {
    await own('repA', { action: 'submit', fields: { description: 'Before revoke.' } });
    const revoke = await staffCall({ action: 'revoke', uid: 'rep-a' });
    expect(revoke.statusCode).toBe(200);
    expect((await db.collection('organization_edit_requests').doc('org-a').get()).exists).toBe(false);
    expect((await own('repA', { action: 'get' })).statusCode).toBe(403);
    expect((await own('repA', { action: 'submit', fields: { description: 'After.' } })).statusCode).toBe(403);
    expect((await db.collection('organization_edit_requests').doc('org-a').get()).exists).toBe(false);
    const rows = await db.collection('admin_logs').where('action', '==', 'revokeOrganizationRepresentative').get();
    expect(rows.docs.map((row) => row.data().docPath)).toEqual(['organization_representatives/rep-a']);
  });

  it('staff apply a queued edit to the draft only; the live document waits for publish', async () => {
    const res = await staffCall({ action: 'apply', organizationId: 'org-b' });
    expect(res.statusCode).toBe(200);
    const draft = (await db.collection('cmsOrganizations_drafts').doc('org-b').get()).data();
    expect(draft.description).toBe('B queued.');
    expect(draft.status).toBe('dirty');
    expect(draft.tier).toBe('silver');
    expect(JSON.stringify(draft)).not.toContain('rep-b');
    expect((await db.collection('cmsOrganizations').doc('org-b').get()).data().description).toBe('B live.');
    expect((await db.collection('organization_edit_requests').doc('org-b').get()).exists).toBe(false);
  });
});
