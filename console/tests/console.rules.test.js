// console/firestore.rules on the real Firestore emulator (ADR 0007 §2).
//
// The console's functions own every write. A client may read only its own
// organization and its members; an operator (console_config/operators) may
// read every organization; nobody writes members, invites, operators or
// rate limits from the browser. The suite runs under its own demo project
// id, so the client rules suites on the same emulator are not affected.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-eventrunner-console';

let testEnv;

/** A signed-in browser client. */
function client(uid, email, verified = true) {
  return testEnv.authenticatedContext(uid, { email, email_verified: verified }).firestore();
}

const ana = () => client('ana', 'ana@example.org');
const ben = () => client('ben', 'ben@example.org');
const stranger = () => client('zed', 'zed@example.org');
const operator = () => client('ops', 'Ops@CCM.example');

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('console/firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'console_config/operators'), { emails: ['ops@ccm.example'] });
    await setDoc(doc(db, 'organizations/o1'), { name: 'Org one', createdBy: 'ana' });
    await setDoc(doc(db, 'organizations/o1/members/ana'), { uid: 'ana', email: 'ana@example.org', role: 'owner' });
    await setDoc(doc(db, 'organizations/o1/members/ben'), { uid: 'ben', email: 'ben@example.org', role: 'editor' });
    await setDoc(doc(db, 'organizations/o2'), { name: 'Org two', createdBy: 'cy' });
    await setDoc(doc(db, 'organizations/o2/members/cy'), { uid: 'cy', email: 'cy@example.org', role: 'owner' });
    await setDoc(doc(db, 'invites/i1'), { orgId: 'o1', email: 'dee@example.org', role: 'editor', tokenHash: 'h', status: 'pending' });
    await setDoc(doc(db, 'console_rate_limits/invite-org-o1'), { count: 1 });
    await setDoc(doc(db, 'applications/a1'), { orgId: 'o1', status: 'draft', answers: {} });
    await setDoc(doc(db, 'applications/a2'), { orgId: 'o2', status: 'submitted', answers: {} });
    await setDoc(doc(db, 'site_names/nclocal'), { appId: 'a1', orgId: 'o1' });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('members read their own organization', () => {
  it('an Owner and an Editor read the organization and its members', async () => {
    for (const db of [ana(), ben()]) {
      await assertSucceeds(getDoc(doc(db, 'organizations/o1')));
      await assertSucceeds(getDocs(collection(db, 'organizations/o1/members')));
      await assertSucceeds(getDoc(doc(db, 'organizations/o1/members/ana')));
    }
  });

  it('a member cannot read another organization or its members', async () => {
    await assertFails(getDoc(doc(ana(), 'organizations/o2')));
    await assertFails(getDocs(collection(ana(), 'organizations/o2/members')));
    await assertFails(getDoc(doc(ana(), 'organizations/o2/members/cy')));
  });

  it('a member cannot list every organization or query members across organizations', async () => {
    await assertFails(getDocs(collection(ana(), 'organizations')));
    await assertFails(getDocs(query(collectionGroup(ana(), 'members'), where('uid', '==', 'ana'))));
  });

  it('a stranger, a signed-out visitor and an unverified member read nothing', async () => {
    await assertFails(getDoc(doc(stranger(), 'organizations/o1')));
    await assertFails(getDocs(collection(stranger(), 'organizations/o1/members')));
    const signedOut = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(signedOut, 'organizations/o1')));
    const unverified = client('ana', 'ana@example.org', false);
    await assertFails(getDoc(doc(unverified, 'organizations/o1')));
    await assertFails(getDocs(collection(unverified, 'organizations/o1/members')));
  });
});

describe('operators read every organization', () => {
  it('an operator reads and lists every organization and member, with any letter case in the email', async () => {
    const db = operator();
    await assertSucceeds(getDoc(doc(db, 'organizations/o2')));
    await assertSucceeds(getDocs(collection(db, 'organizations')));
    await assertSucceeds(getDocs(collection(db, 'organizations/o2/members')));
    await assertSucceeds(getDocs(collectionGroup(db, 'members')));
  });

  it('an operator with an unverified email is not an operator', async () => {
    const db = client('ops', 'ops@ccm.example', false);
    await assertFails(getDoc(doc(db, 'organizations/o2')));
    await assertFails(getDocs(collection(db, 'organizations')));
  });

  it('nobody reads the allowlist, invites or rate limits from the browser', async () => {
    for (const db of [ana(), operator()]) {
      await assertFails(getDoc(doc(db, 'console_config/operators')));
      await assertFails(getDoc(doc(db, 'invites/i1')));
      await assertFails(getDocs(collection(db, 'invites')));
      await assertFails(getDoc(doc(db, 'console_rate_limits/invite-org-o1')));
    }
  });
});

describe('no client writes', () => {
  it('an Owner cannot change the organization, add or change members, or remove one', async () => {
    const db = ana();
    await assertFails(updateDoc(doc(db, 'organizations/o1'), { name: 'Renamed' }));
    await assertFails(setDoc(doc(db, 'organizations/o3'), { name: 'New', createdBy: 'ana' }));
    await assertFails(setDoc(doc(db, 'organizations/o1/members/zed'), { uid: 'zed', email: 'zed@example.org', role: 'owner' }));
    await assertFails(updateDoc(doc(db, 'organizations/o1/members/ben'), { role: 'owner' }));
    await assertFails(deleteDoc(doc(db, 'organizations/o1/members/ben')));
  });

  it('a stranger cannot add themselves to an organization', async () => {
    await assertFails(setDoc(doc(stranger(), 'organizations/o1/members/zed'), { uid: 'zed', email: 'zed@example.org', role: 'owner' }));
  });

  it('nobody writes invites, the allowlist or rate limits, operators included', async () => {
    for (const db of [ana(), operator(), stranger()]) {
      await assertFails(setDoc(doc(db, 'invites/i2'), { orgId: 'o1', email: 'x@example.org', role: 'owner', status: 'pending' }));
      await assertFails(updateDoc(doc(db, 'invites/i1'), { status: 'accepted' }));
      await assertFails(setDoc(doc(db, 'console_config/operators'), { emails: ['zed@example.org'] }));
      await assertFails(setDoc(doc(db, 'console_rate_limits/invite-org-o1'), { count: 0 }));
    }
  });

  it('an operator cannot change a client team either', async () => {
    const db = operator();
    await assertFails(updateDoc(doc(db, 'organizations/o2/members/cy'), { role: 'editor' }));
    await assertFails(updateDoc(doc(db, 'organizations/o2'), { name: 'Renamed' }));
  });
});

describe('guided-setup requests', () => {
  it('an Owner and an Editor read and list their own organization\'s requests', async () => {
    for (const db of [ana(), ben()]) {
      await assertSucceeds(getDoc(doc(db, 'applications/a1')));
      await assertSucceeds(getDocs(query(collection(db, 'applications'), where('orgId', '==', 'o1'))));
    }
  });

  it('a member cannot read or list another organization\'s requests, or list them all', async () => {
    await assertFails(getDoc(doc(ana(), 'applications/a2')));
    await assertFails(getDocs(query(collection(ana(), 'applications'), where('orgId', '==', 'o2'))));
    await assertFails(getDocs(collection(ana(), 'applications')));
  });

  it('a stranger, a signed-out visitor and an unverified member read no request', async () => {
    await assertFails(getDoc(doc(stranger(), 'applications/a1')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'applications/a1')));
    await assertFails(getDoc(doc(client('ana', 'ana@example.org', false), 'applications/a1')));
  });

  it('an operator reads and lists every request', async () => {
    await assertSucceeds(getDoc(doc(operator(), 'applications/a2')));
    await assertSucceeds(getDocs(collection(operator(), 'applications')));
  });

  it('nobody reads web-address names from the browser', async () => {
    for (const db of [ana(), operator(), stranger()]) {
      await assertFails(getDoc(doc(db, 'site_names/nclocal')));
      await assertFails(getDocs(collection(db, 'site_names')));
    }
  });

  it('nobody writes a request or a web-address name, operators included', async () => {
    for (const db of [ana(), ben(), operator(), stranger()]) {
      await assertFails(setDoc(doc(db, 'applications/a3'), { orgId: 'o1', status: 'draft' }));
      await assertFails(updateDoc(doc(db, 'applications/a1'), { status: 'approved' }));
      await assertFails(deleteDoc(doc(db, 'applications/a1')));
      await assertFails(setDoc(doc(db, 'site_names/mine'), { appId: 'a1', orgId: 'o1' }));
      await assertFails(deleteDoc(doc(db, 'site_names/nclocal')));
    }
  });
});
