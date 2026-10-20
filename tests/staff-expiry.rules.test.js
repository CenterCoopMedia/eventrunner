// Expiring staff access (issue #331) against the real Firestore emulator.
//
// A staff grant may carry an end time in config/bootstrap.staffExpiry, a map
// from the lowercased address to a Timestamp. firestore.rules isStaff()
// admits the address while request.time is before that instant, and refuses
// it from then on. The same signed-in client is used before and after the
// end, so a token issued while the grant worked carries nothing past it.
//
// The last block runs the real server code (functions/src/admin/access.cjs
// and core/auth.cjs requireAdmin) on the same emulator documents, so the
// rules and the server are shown to agree on one stored grant.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Timestamp, collection, doc, getDoc, getDocs, limit, query, setDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { createSetAdminAccessHandler } = require('../functions/src/admin/access.cjs');
const { requireAdmin } = require('../functions/src/core/auth.cjs');

const PROJECT_ID = 'demo-run-of-show';
const OPERATOR = 'expiry-ops@example.test';
const DEMO = 'expiry-demo@example.test';
const OTHER = 'expiry-other@example.test';
const PERMANENT = 'expiry-desk@example.test';
const QUIET = { error() {}, warn() {}, info() {} };
// How long a "just before" grant has left when it is read: long enough for
// one emulator round trip, short enough to wait out in the test.
const MARGIN_MS = 1500;

let testEnv;
let adminApp;
let adminDb;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** A signed-in client with a verified address. */
function client(email, uid = email) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

/** Write config/bootstrap with the rules off, as the server does. */
async function bootstrap(data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'config/bootstrap'), data);
  });
}

const draftRead = (db) => getDoc(doc(db, 'cmsContent_drafts/pub'));
// The two reads the browser's tier probe makes (AuthContext.jsx).
const probeAdmin = (db) => getDocs(query(collection(db, 'cmsContent_drafts'), limit(1)));
const probeOperator = (db) => getDocs(query(collection(db, 'admin_logs'), limit(1)));

const at = (ms) => Timestamp.fromMillis(ms);

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `staff-expiry-${process.pid}`);
  adminDb = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'cmsContent_drafts/pub'), { body: 'Draft.' });
    await setDoc(doc(db, 'admin_logs/l1'), { action: 'seed' });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('firestore.rules: a staff grant with an end time', () => {
  it('works just before its end and stops just after it, for the same account and token claims', async () => {
    const ends = Date.now() + MARGIN_MS;
    await bootstrap({ adminEmails: [OPERATOR], staffEmails: [DEMO], staffExpiry: { [DEMO]: at(ends) } });
    const before = client(DEMO, 'demo-1');
    await assertSucceeds(draftRead(before));
    await assertSucceeds(probeAdmin(before));
    // Staff, not operator, while it works.
    await assertFails(probeOperator(before));

    await sleep(Math.max(0, ends - Date.now()) + 250);
    // A new client for the same account. The emulator holds request.time
    // for a connection that is already open, so a read on the SAME client
    // object still passes here, even for a rule as plain as
    // `request.time < resource.data.until` (checked while building #331).
    // A revocation is not affected: it changes the document, and the same
    // client is refused at once (the last test in this block).
    const after = client(DEMO, 'demo-1');
    await assertFails(draftRead(after));
    await assertFails(probeAdmin(after));
  });

  it('is refused one second after its end, and works one minute before it', async () => {
    await bootstrap({ adminEmails: [OPERATOR], staffEmails: [DEMO], staffExpiry: { [DEMO]: at(Date.now() - 1000) } });
    await assertFails(draftRead(client(DEMO)));
    await bootstrap({ adminEmails: [OPERATOR], staffEmails: [DEMO], staffExpiry: { [DEMO]: at(Date.now() + 60_000) } });
    await assertSucceeds(draftRead(client(DEMO)));
  });

  it('a mixed-case token address meets the same end time', async () => {
    await bootstrap({ adminEmails: [OPERATOR], staffEmails: [DEMO], staffExpiry: { [DEMO]: at(Date.now() - 1000) } });
    await assertFails(draftRead(client('Expiry-Demo@Example.TEST', 'demo-mixed')));
  });

  it('fails closed when the end time is missing or is not a timestamp', async () => {
    for (const bad of [null, 'next week', Date.now() + 60_000, { seconds: 4_000_000_000, nanoseconds: 0 }, [], true]) {
      await bootstrap({ adminEmails: [OPERATOR], staffEmails: [DEMO, PERMANENT], staffExpiry: { [DEMO]: bad } });
      await assertFails(draftRead(client(DEMO)));
      // One bad entry takes nobody else's access.
      await assertSucceeds(draftRead(client(PERMANENT)));
      await assertSucceeds(probeOperator(client(OPERATOR)));
    }
  });

  it('a staffExpiry field that is not a map refuses every staff grant, and never an operator', async () => {
    for (const bad of [null, 'broken', [DEMO], 42, at(Date.now() + 60_000)]) {
      await bootstrap({ adminEmails: [OPERATOR], staffEmails: [PERMANENT], staffExpiry: bad });
      await assertFails(draftRead(client(PERMANENT)));
      await assertSucceeds(draftRead(client(OPERATOR)));
      await assertSucceeds(probeOperator(client(OPERATOR)));
    }
  });

  it('a staff address with no key in the map is a permanent grant, as every grant before issue 331 is', async () => {
    await bootstrap({ adminEmails: [OPERATOR], staffEmails: [PERMANENT, DEMO], staffExpiry: { [DEMO]: at(Date.now() - 1000) } });
    await assertSucceeds(draftRead(client(PERMANENT)));
    await bootstrap({ adminEmails: [OPERATOR], staffEmails: [PERMANENT] });
    await assertSucceeds(draftRead(client(PERMANENT)));
  });

  it('a mixed-case key is no end time: the rules read the lowercased address only, as the server does', async () => {
    await bootstrap({ adminEmails: [OPERATOR], staffEmails: [DEMO], staffExpiry: { 'Expiry-Demo@Example.test': at(Date.now() - 1000) } });
    await assertSucceeds(draftRead(client(DEMO)));
  });

  it('an operator never expires, even with an ended staff entry for the same address', async () => {
    await bootstrap({ adminEmails: [OPERATOR], staffEmails: [OPERATOR], staffExpiry: { [OPERATOR]: at(Date.now() - 1000) } });
    await assertSucceeds(draftRead(client(OPERATOR)));
    await assertSucceeds(probeOperator(client(OPERATOR)));
  });

  it('two grants end on their own times, and a revoked one stops at once', async () => {
    await bootstrap({
      adminEmails: [OPERATOR],
      staffEmails: [DEMO, OTHER],
      staffExpiry: { [DEMO]: at(Date.now() - 1000), [OTHER]: at(Date.now() + 60_000) },
    });
    await assertFails(draftRead(client(DEMO)));
    const other = client(OTHER);
    await assertSucceeds(draftRead(other));
    // Revoked before its end: off the list, so refused at once, on the
    // same client that read a moment ago.
    await bootstrap({ adminEmails: [OPERATOR], staffEmails: [DEMO], staffExpiry: { [DEMO]: at(Date.now() - 1000) } });
    await assertFails(draftRead(other));
  });
});

describe('the server and the rules agree on one stored grant', () => {
  const auth = {
    async verifyIdToken(token) {
      if (token === 'ops') return { uid: 'ops-1', email: OPERATOR, email_verified: true };
      if (token === 'demo') return { uid: 'demo-1', email: DEMO, email_verified: true };
      throw new Error('invalid token');
    },
  };
  const getConfig = async () => ({ bootstrap: null });

  function makeRes() {
    const res = {
      statusCode: null,
      body: null,
      set() { return res; },
      status(code) { res.statusCode = code; return res; },
      json(payload) { res.body = payload; return res; },
    };
    return res;
  }

  it('a grant set through setAdminAccess works on both before its end and on neither after it', async () => {
    await adminDb.collection('config').doc('bootstrap').set({ adminEmails: [OPERATOR], staffEmails: [] });
    const ends = new Date(Date.now() + 4000);
    const res = makeRes();
    await createSetAdminAccessHandler({ db: adminDb, auth, getConfig, log: QUIET })(
      { method: 'POST', headers: { authorization: 'Bearer ops' }, body: { email: DEMO, tier: 'staff', expiresAt: ends.toISOString() } },
      res,
    );
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    // Stored as a Timestamp, which is what the rules compare with.
    const stored = (await adminDb.collection('config').doc('bootstrap').get()).data();
    expect(stored.staffExpiry[DEMO]).toBeInstanceOf(Object);
    expect(stored.staffExpiry[DEMO].toMillis()).toBe(ends.getTime());

    const gate = () => requireAdmin(
      { auth, db: adminDb, getConfig },
      { headers: { authorization: 'Bearer demo' } },
      { tier: 'staff' },
    );
    expect((await gate()).ok).toBe(true);
    await assertSucceeds(draftRead(client(DEMO, 'demo-1')));

    await sleep(Math.max(0, ends.getTime() - Date.now()) + 250);
    // The same token string the server admitted a moment ago.
    expect((await gate()).status).toBe(403);
    await assertFails(draftRead(client(DEMO, 'demo-1')));
  });
});
