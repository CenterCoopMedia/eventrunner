'use strict';

// Organization representatives (issue #334): the staff grant and its
// revocation, the representative's own read and edit, and the review queue
// staff resolve into the organization's draft.

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb: makeBareFakeDb } = require('./firestoreFake.cjs');
const { publishDocs } = require('./store.cjs');
const {
  REPRESENTATIVES,
  EDIT_REQUESTS,
  createOwnOrganizationProfileHandler,
  createOrganizationRepresentativesHandler,
} = require('./organizationRepresentatives.cjs');

const OPERATOR = 'operator@example.org';
const STAFF = 'staff@example.org';
const BOOTSTRAP_DOC = { adminEmails: [OPERATOR], staffEmails: [STAFF] };
const getConfig = async () => ({ bootstrap: BOOTSTRAP_DOC });
const QUIET = { warn() {}, error() {}, info() {} };
const T0 = Date.parse('2026-10-20T10:00:00.000Z');
const now = () => T0;

const ORG_A = {
  name: 'Beacon Fund',
  tier: 'presenting',
  order: 0,
  logoPath: 'cms-images/beacon.webp',
  url: 'https://beacon.example.org/',
  description: 'Funds the travel grants.',
  bio: 'Beacon has funded local reporting since 2010.',
  supportDescription: 'Beacon pays for the opening reception.',
  visible: true,
  revision: 3,
  publishedBy: 'staff-1',
};
const ORG_B = {
  name: 'Tide Media',
  tier: 'partner',
  order: 1,
  url: 'https://tide.example.org/',
  description: 'A newsroom on the coast.',
  visible: true,
  revision: 1,
};

function seed(extra = {}) {
  return makeBareFakeDb({
    'config/bootstrap': BOOTSTRAP_DOC,
    'config/event': { name: 'Example event', historicalDemo: false },
    'cmsOrganizations/beacon-fund': ORG_A,
    'cmsOrganizations/tide-media': ORG_B,
    'users/uid-ada': { uid: 'uid-ada', email: 'ada@example.org' },
    'users/uid-bo': { uid: 'uid-bo', email: 'bo@example.org' },
    [`${REPRESENTATIVES}/uid-ada`]: {
      uid: 'uid-ada', email: 'ada@example.org', organizationId: 'beacon-fund',
      grantedAt: new Date(T0 - 1000), grantedBy: STAFF,
    },
    [`${REPRESENTATIVES}/uid-bo`]: {
      uid: 'uid-bo', email: 'bo@example.org', organizationId: 'tide-media',
      grantedAt: new Date(T0 - 1000), grantedBy: STAFF,
    },
    ...extra,
  });
}

const TOKENS = {
  operator: { uid: 'operator-1', email: OPERATOR, email_verified: true },
  staff: { uid: 'staff-1', email: STAFF, email_verified: true },
  ada: { uid: 'uid-ada', email: 'ada@example.org', email_verified: true },
  bo: { uid: 'uid-bo', email: 'bo@example.org', email_verified: true },
  cy: { uid: 'uid-cy', email: 'cy@example.org', email_verified: true },
  unverified: { uid: 'uid-ada', email: 'ada@example.org', email_verified: false },
};
const ACCOUNTS = {
  'ada@example.org': { uid: 'uid-ada', email: 'ada@example.org', emailVerified: true },
  'bo@example.org': { uid: 'uid-bo', email: 'bo@example.org', emailVerified: true },
  'cy@example.org': { uid: 'uid-cy', email: 'cy@example.org', emailVerified: true },
  'unverified@example.org': { uid: 'uid-un', email: 'unverified@example.org', emailVerified: false },
  'disabled@example.org': { uid: 'uid-off', email: 'disabled@example.org', emailVerified: true, disabled: true },
};
const auth = {
  revocationChecks: [],
  async verifyIdToken(token, checkRevoked = false) {
    auth.revocationChecks.push(checkRevoked);
    if (!TOKENS[token]) throw new Error('invalid token');
    return TOKENS[token];
  },
  async getUserByEmail(email) {
    const account = ACCOUNTS[email];
    if (!account) {
      const err = new Error('no user');
      err.code = 'auth/user-not-found';
      throw err;
    }
    return account;
  },
};

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

const req = (token, body, method = 'POST') => ({
  method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

async function own(db, token, body, at = now) {
  const res = makeRes();
  await createOwnOrganizationProfileHandler({ db, auth, now: at, log: QUIET })(req(token, body), res);
  return res;
}

async function staff(db, body, token = 'staff', at = now) {
  const res = makeRes();
  await createOrganizationRepresentativesHandler({ db, auth, getConfig, now: at, log: QUIET })(req(token, body), res);
  return res;
}

const auditRows = (db) => db.ids('admin_logs').map((id) => db.read('admin_logs', id));
const liveAndDraftWrites = (db) => db.writes.filter((write) => write.path.startsWith('cmsOrganizations'));

// ------------------------------------------------------------------ grants

test('staff grant an account representative status for one organization, with an audit row', async () => {
  const db = seed();
  const res = await staff(db, { action: 'grant', organizationId: 'tide-media', email: '  CY@Example.org ' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { uid: 'uid-cy', organizationId: 'tide-media', changed: true });
  const grant = db.read(REPRESENTATIVES, 'uid-cy');
  assert.equal(grant.organizationId, 'tide-media');
  assert.equal(grant.email, 'cy@example.org');
  assert.equal(grant.grantedBy, STAFF);
  assert.equal(grant.grantedAt.getTime(), T0);
  const rows = auditRows(db);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    action: 'grantOrganizationRepresentative',
    docPath: `${REPRESENTATIVES}/uid-cy`,
    uid: 'staff-1',
    email: STAFF,
    at: new Date(T0),
    details: { organizationId: 'tide-media' },
  });

  // The same grant again changes nothing and writes no second row.
  const again = await staff(db, { action: 'grant', organizationId: 'tide-media', email: 'cy@example.org' });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.changed, false);
  assert.equal(auditRows(db).length, 1);
});

test('a grant refuses a second organization, an unknown or unverified account, and a missing organization', async () => {
  const db = seed();
  const other = await staff(db, { action: 'grant', organizationId: 'tide-media', email: 'ada@example.org' });
  assert.equal(other.statusCode, 409);
  assert.equal(other.body.error.code, 'already-representative');
  assert.equal(db.read(REPRESENTATIVES, 'uid-ada').organizationId, 'beacon-fund');

  const unknown = await staff(db, { action: 'grant', organizationId: 'tide-media', email: 'nobody@example.org' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.body.error.code, 'no-account');

  const unverified = await staff(db, { action: 'grant', organizationId: 'tide-media', email: 'unverified@example.org' });
  assert.equal(unverified.statusCode, 409);
  assert.equal(unverified.body.error.code, 'unverified-account');

  const disabled = await staff(db, { action: 'grant', organizationId: 'tide-media', email: 'disabled@example.org' });
  assert.equal(disabled.statusCode, 409);
  assert.equal(disabled.body.error.code, 'unverified-account');

  const missing = await staff(db, { action: 'grant', organizationId: 'no-such-org', email: 'cy@example.org' });
  assert.equal(missing.statusCode, 404);

  for (const bad of [{ organizationId: 'tide-media' }, { email: 'cy@example.org' }, { organizationId: 'a/b', email: 'cy@example.org' }, { organizationId: 'tide-media', email: 'not-an-address' }]) {
    const res = await staff(db, { action: 'grant', ...bad });
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
  assert.equal(db.read(REPRESENTATIVES, 'uid-cy'), undefined);
  assert.equal(auditRows(db).length, 0);
});

test('a draft-only organization can take a representative', async () => {
  const db = seed({ 'cmsOrganizations_drafts/new-grant': { name: 'New Grant', status: 'dirty', visible: true } });
  const res = await staff(db, { action: 'grant', organizationId: 'new-grant', email: 'cy@example.org' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('only staff and operators reach the staff endpoint; a representative is refused', async () => {
  const db = seed({
    [`${EDIT_REQUESTS}/tide-media`]: {
      organizationId: 'tide-media', fields: { description: 'Forged.' }, base: { description: ORG_B.description },
      submittedByUid: 'uid-bo', submittedByEmail: 'bo@example.org', submittedAt: new Date(T0),
    },
  });
  assert.equal((await staff(db, { action: 'grant', organizationId: 'beacon-fund', email: 'cy@example.org' }, null)).statusCode, 401);
  // A representative of one organization cannot approve an edit, grant
  // access, or revoke anybody, on its own organization or another.
  for (const body of [
    { action: 'apply', organizationId: 'tide-media' },
    { action: 'apply', organizationId: 'beacon-fund' },
    { action: 'grant', organizationId: 'tide-media', email: 'ada@example.org' },
    { action: 'revoke', uid: 'uid-bo' },
    { action: 'discard', organizationId: 'tide-media' },
  ]) {
    const res = await staff(db, body, 'ada');
    assert.equal(res.statusCode, 403, JSON.stringify(body));
  }
  assert.equal(db.read(REPRESENTATIVES, 'uid-bo').organizationId, 'tide-media');
  assert.ok(db.read(EDIT_REQUESTS, 'tide-media'));
  assert.equal(db.read('cmsOrganizations_drafts', 'tide-media'), undefined);
  const op = await staff(db, { action: 'grant', organizationId: 'beacon-fund', email: 'cy@example.org' }, 'operator');
  assert.equal(op.statusCode, 200);
  assert.equal((await staff(db, { action: 'nope' })).statusCode, 400);
  assert.equal((await staff(db, { action: 'grant' }, 'staff', now)).statusCode, 400);
});

// ------------------------------------------------- the representative's view

test('a representative reads its own organization: the public profile and nothing staff-owned', async () => {
  const db = seed();
  const res = await own(db, 'ada', { action: 'get' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    organizationId: 'beacon-fund',
    organization: {
      name: ORG_A.name,
      logoPath: ORG_A.logoPath,
      description: ORG_A.description,
      bio: ORG_A.bio,
      url: ORG_A.url,
    },
    pending: null,
    otherPending: false,
  });
  assert.ok(auth.revocationChecks.every(Boolean), 'every token is checked for revocation');
});

test('an account that represents nothing is refused, and an organization id in the body changes nothing', async () => {
  const db = seed();
  const res = await own(db, 'cy', { action: 'get', organizationId: 'beacon-fund' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'not-representative');
  assert.equal((await own(db, null, { action: 'get' })).statusCode, 401);
  assert.equal((await own(db, 'unverified', { action: 'get' })).statusCode, 403);
  // A representative of B asking for A gets B.
  const bo = await own(db, 'bo', { action: 'get', organizationId: 'beacon-fund' });
  assert.equal(bo.body.organizationId, 'tide-media');
  assert.equal(bo.body.organization.name, 'Tide Media');
});

test('an organization that is not published yet shows no profile and takes no edit', async () => {
  const db = seed({
    [`${REPRESENTATIVES}/uid-cy`]: { uid: 'uid-cy', email: 'cy@example.org', organizationId: 'new-grant' },
    'cmsOrganizations_drafts/new-grant': { name: 'New Grant', description: 'Staff draft text.', status: 'dirty' },
  });
  const res = await own(db, 'cy', { action: 'get' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { organizationId: 'new-grant', organization: null, pending: null, otherPending: false });
  const edit = await own(db, 'cy', { action: 'submit', fields: { description: 'Mine.' } });
  assert.equal(edit.statusCode, 409);
  assert.equal(edit.body.error.code, 'not-published');
  assert.equal(db.read(EDIT_REQUESTS, 'new-grant'), undefined);
});

// ------------------------------------------------------- submitting an edit

test('a representative edit goes to the review queue, never to the live or draft organization', async () => {
  const db = seed();
  const res = await own(db, 'ada', {
    action: 'submit',
    fields: { description: '  Funds travel and child care.  ', url: 'https://beacon.example.org/grants' },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.pending.fields, {
    description: 'Funds travel and child care.',
    url: 'https://beacon.example.org/grants',
  });
  assert.deepEqual(liveAndDraftWrites(db), [], 'nothing reaches cmsOrganizations or its drafts');
  assert.equal(db.read('cmsOrganizations', 'beacon-fund').description, ORG_A.description);
  const stored = db.read(EDIT_REQUESTS, 'beacon-fund');
  assert.deepEqual(stored.fields, {
    description: 'Funds travel and child care.',
    url: 'https://beacon.example.org/grants',
  });
  assert.deepEqual(stored.base, { description: ORG_A.description, url: ORG_A.url });
  assert.equal(stored.submittedByUid, 'uid-ada');
  assert.equal(stored.submittedByEmail, 'ada@example.org');
  assert.equal(stored.organizationId, 'beacon-fund');
  const rows = auditRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'submitOrganizationEdit');
  assert.equal(rows[0].docPath, `${EDIT_REQUESTS}/beacon-fund`);
  assert.equal(rows[0].uid, 'uid-ada');
  assert.equal(JSON.stringify(rows[0]).includes('child care'), false, 'the audit row holds no text');

  // The representative sees the queued edit apart from the live profile.
  const view = await own(db, 'ada', { action: 'get' });
  assert.equal(view.body.organization.description, ORG_A.description);
  assert.deepEqual(view.body.pending.fields, stored.fields);
  assert.equal(view.body.pending.submittedAt, new Date(T0).toISOString());
});

test('a representative cannot touch a staff-owned field, by name, and nothing is written', async () => {
  const db = seed();
  for (const field of ['tier', 'order', 'name', 'logoPath', 'visible', 'supportDescription', 'readMorePath', 'status', 'revision']) {
    const res = await own(db, 'ada', { action: 'submit', fields: { description: 'Fine.', [field]: 'x' } });
    assert.equal(res.statusCode, 400, field);
    assert.match(res.body.error.message, new RegExp(`^${field}: representatives cannot change this field`));
  }
  const script = await own(db, 'ada', { action: 'submit', fields: { url: 'javascript:alert(1)' } });
  assert.equal(script.statusCode, 400);
  assert.equal(db.read(EDIT_REQUESTS, 'beacon-fund'), undefined);
  assert.equal(auditRows(db).length, 0);
});

test('a representative of organization A cannot edit organization B, whatever the body names', async () => {
  const db = seed();
  const res = await own(db, 'ada', {
    action: 'submit',
    organizationId: 'tide-media',
    docId: 'tide-media',
    fields: { description: 'Written by A.' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.organizationId, 'beacon-fund');
  assert.equal(db.read(EDIT_REQUESTS, 'tide-media'), undefined);
  assert.equal(db.read(EDIT_REQUESTS, 'beacon-fund').fields.description, 'Written by A.');
});

test('a second edit merges with the first and keeps the first base; reverting every field withdraws it', async () => {
  const db = seed();
  await own(db, 'ada', { action: 'submit', fields: { description: 'First.' } });
  await own(db, 'ada', { action: 'submit', fields: { description: 'Second.', bio: 'New bio.' } });
  let stored = db.read(EDIT_REQUESTS, 'beacon-fund');
  assert.deepEqual(stored.fields, { description: 'Second.', bio: 'New bio.' });
  assert.deepEqual(stored.base, { description: ORG_A.description, bio: ORG_A.bio });

  // Back to the live text: that field leaves the request.
  await own(db, 'ada', { action: 'submit', fields: { description: ORG_A.description } });
  stored = db.read(EDIT_REQUESTS, 'beacon-fund');
  assert.deepEqual(stored.fields, { bio: 'New bio.' });
  assert.deepEqual(stored.base, { bio: ORG_A.bio });

  const res = await own(db, 'ada', { action: 'submit', fields: { bio: ORG_A.bio } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pending, null);
  assert.equal(db.read(EDIT_REQUESTS, 'beacon-fund'), undefined);
});

test('a historical demo refuses a representative edit', async () => {
  const db = seed({ 'config/event': { name: 'Example event', historicalDemo: true } });
  const res = await own(db, 'ada', { action: 'submit', fields: { description: 'Demo.' } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'read-only-demo');
  assert.equal(db.read(EDIT_REQUESTS, 'beacon-fund'), undefined);
});

test('the representative endpoint takes POST only and a known action', async () => {
  const db = seed();
  assert.equal((await own(db, 'ada', { action: 'get' }, now)).statusCode, 200);
  const res = makeRes();
  await createOwnOrganizationProfileHandler({ db, auth, now, log: QUIET })(req('ada', {}, 'GET'), res);
  assert.equal(res.statusCode, 405);
  assert.equal((await own(db, 'ada', { action: 'grant' })).statusCode, 400);
});

// ------------------------------------------------------------- revocation

test('staff revoke a representative: the grant and its unreviewed edit go, with an audit row', async () => {
  const db = seed();
  await own(db, 'ada', { action: 'submit', fields: { description: 'Pending text.' } });
  const res = await staff(db, { action: 'revoke', uid: 'uid-ada' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { uid: 'uid-ada', organizationId: 'beacon-fund', discardedEdit: true });
  assert.equal(db.read(REPRESENTATIVES, 'uid-ada'), undefined);
  assert.equal(db.read(EDIT_REQUESTS, 'beacon-fund'), undefined);
  const row = auditRows(db).find((entry) => entry.action === 'revokeOrganizationRepresentative');
  assert.deepEqual(row, {
    action: 'revokeOrganizationRepresentative',
    docPath: `${REPRESENTATIVES}/uid-ada`,
    uid: 'staff-1',
    email: STAFF,
    at: new Date(T0),
    details: { organizationId: 'beacon-fund', discardedEdit: true },
  });

  // The revoked account can no longer read or edit.
  assert.equal((await own(db, 'ada', { action: 'get' })).statusCode, 403);
  const after = await own(db, 'ada', { action: 'submit', fields: { description: 'Too late.' } });
  assert.equal(after.statusCode, 403);
  assert.equal(db.read(EDIT_REQUESTS, 'beacon-fund'), undefined);

  assert.equal((await staff(db, { action: 'revoke', uid: 'uid-ada' })).statusCode, 404);
  assert.equal((await staff(db, { action: 'revoke' })).statusCode, 400);
});

test('revoking one representative keeps an edit another representative sent', async () => {
  const db = seed({
    [`${REPRESENTATIVES}/uid-cy`]: { uid: 'uid-cy', email: 'cy@example.org', organizationId: 'beacon-fund' },
  });
  await own(db, 'cy', { action: 'submit', fields: { description: 'From Cy.' } });
  const res = await staff(db, { action: 'revoke', uid: 'uid-ada' });
  assert.equal(res.body.discardedEdit, false);
  assert.equal(db.read(EDIT_REQUESTS, 'beacon-fund').submittedByUid, 'uid-cy');
});

// ------------------------------------------------------- review and apply

test('staff apply an edit to the draft, keeping their own draft changes; the public page changes only on publish', async () => {
  const db = seed({
    // Staff are editing the same organization: a new tier and name in the draft.
    'cmsOrganizations_drafts/beacon-fund': {
      ...ORG_A, revision: undefined, publishedBy: undefined,
      name: 'Beacon Fund for Local News', tier: 'founding', status: 'dirty', basedOnRevision: 3,
    },
  });
  await own(db, 'ada', { action: 'submit', fields: { description: 'Funds travel and child care.', bio: 'A new history.' } });

  const res = await staff(db, { action: 'apply', organizationId: 'beacon-fund' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    organizationId: 'beacon-fund',
    docPath: 'cmsOrganizations_drafts/beacon-fund',
    appliedFields: ['description', 'bio'],
    applied: { description: 'Funds travel and child care.', bio: 'A new history.' },
  });
  const draft = db.read('cmsOrganizations_drafts', 'beacon-fund');
  assert.equal(draft.description, 'Funds travel and child care.');
  assert.equal(draft.bio, 'A new history.');
  assert.equal(draft.name, 'Beacon Fund for Local News', 'the staff edit to the name is kept');
  assert.equal(draft.tier, 'founding', 'the staff edit to the tier is kept');
  assert.equal(draft.status, 'dirty');
  assert.equal(draft.updatedBy, STAFF);
  for (const key of Object.keys(draft)) {
    assert.equal(/submitted|representative/i.test(key), false, `no representative identity on the draft: ${key}`);
  }
  assert.equal(JSON.stringify(draft).includes('ada@example.org'), false);
  assert.equal(db.read(EDIT_REQUESTS, 'beacon-fund'), undefined);
  assert.equal(db.read('cmsOrganizations', 'beacon-fund').description, ORG_A.description, 'live is untouched until publish');
  const row = auditRows(db).find((entry) => entry.action === 'applyOrganizationEdit');
  assert.equal(row.docPath, 'cmsOrganizations_drafts/beacon-fund');
  assert.deepEqual(row.details, { fields: ['description', 'bio'], overwrite: false });

  await publishDocs({
    db, collection: 'cmsOrganizations', docIds: ['beacon-fund'], actor: { uid: 'staff-1', email: STAFF }, now,
  });
  const live = db.read('cmsOrganizations', 'beacon-fund');
  assert.equal(live.description, 'Funds travel and child care.');
  assert.equal(live.name, 'Beacon Fund for Local News');
  assert.equal(JSON.stringify(live).includes('ada@example.org'), false);
  assert.equal(JSON.stringify(live).includes('uid-ada'), false);
});

test('apply forks a draft from the live organization when staff have none, keeping visibility', async () => {
  const db = seed({ 'cmsOrganizations/beacon-fund': { ...ORG_A, visible: false } });
  await own(db, 'ada', { action: 'submit', fields: { url: 'https://beacon.example.org/new' } });
  const res = await staff(db, { action: 'apply', organizationId: 'beacon-fund' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const draft = db.read('cmsOrganizations_drafts', 'beacon-fund');
  assert.equal(draft.url, 'https://beacon.example.org/new');
  assert.equal(draft.visible, false);
  assert.equal(draft.basedOnRevision, 3);
  assert.equal(draft.supportDescription, ORG_A.supportDescription);
});

test('apply refuses a field staff changed since the edit was sent, until staff choose to overwrite', async () => {
  const db = seed();
  await own(db, 'ada', { action: 'submit', fields: { description: 'From the representative.', bio: 'New bio.' } });
  // Staff then change the description in their draft.
  await db.collection('cmsOrganizations_drafts').doc('beacon-fund').set({
    ...ORG_A, revision: undefined, publishedBy: undefined,
    description: 'From staff.', status: 'dirty', basedOnRevision: 3,
  });

  const refused = await staff(db, { action: 'apply', organizationId: 'beacon-fund' });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error.code, 'staff-changed');
  assert.match(refused.body.error.message, /description/);
  assert.equal(refused.body.error.message.includes('bio'), false);
  assert.equal(db.read('cmsOrganizations_drafts', 'beacon-fund').description, 'From staff.');
  assert.ok(db.read(EDIT_REQUESTS, 'beacon-fund'));

  const forced = await staff(db, { action: 'apply', organizationId: 'beacon-fund', overwrite: true });
  assert.equal(forced.statusCode, 200, JSON.stringify(forced.body));
  assert.equal(db.read('cmsOrganizations_drafts', 'beacon-fund').description, 'From the representative.');
  const row = auditRows(db).find((entry) => entry.action === 'applyOrganizationEdit');
  assert.deepEqual(row.details, { fields: ['description', 'bio'], overwrite: true });
});

test('a staff change that matches the representative text is not a conflict', async () => {
  const db = seed();
  await own(db, 'ada', { action: 'submit', fields: { description: 'Same text.' } });
  await db.collection('cmsOrganizations_drafts').doc('beacon-fund').set({
    ...ORG_A, revision: undefined, publishedBy: undefined, description: 'Same text.', status: 'dirty',
  });
  const res = await staff(db, { action: 'apply', organizationId: 'beacon-fund' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('apply refuses an edit whose sender lost access, and an organization that is gone', async () => {
  const db = seed({
    [`${EDIT_REQUESTS}/beacon-fund`]: {
      organizationId: 'beacon-fund', fields: { description: 'Stale.' }, base: { description: ORG_A.description },
      submittedByUid: 'uid-gone', submittedByEmail: 'gone@example.org', submittedAt: new Date(T0),
    },
    // Bo represents tide-media, not beacon-fund.
    [`${EDIT_REQUESTS}/tide-media`]: {
      organizationId: 'tide-media', fields: { description: 'Crossed.' }, base: { description: ORG_B.description },
      submittedByUid: 'uid-ada', submittedByEmail: 'ada@example.org', submittedAt: new Date(T0),
    },
  });
  for (const organizationId of ['beacon-fund', 'tide-media']) {
    const res = await staff(db, { action: 'apply', organizationId });
    assert.equal(res.statusCode, 409, organizationId);
    assert.equal(res.body.error.code, 'representative-revoked');
  }
  assert.equal(db.read('cmsOrganizations_drafts', 'beacon-fund'), undefined);
  assert.equal(db.read('cmsOrganizations_drafts', 'tide-media'), undefined);

  assert.equal((await staff(db, { action: 'apply', organizationId: 'no-such-org' })).statusCode, 404);
});

test('staff discard an edit: the request goes, the organization is untouched, and a row is written', async () => {
  const db = seed();
  await own(db, 'ada', { action: 'submit', fields: { description: 'Not wanted.' } });
  const res = await staff(db, { action: 'discard', organizationId: 'beacon-fund' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.read(EDIT_REQUESTS, 'beacon-fund'), undefined);
  assert.equal(db.read('cmsOrganizations_drafts', 'beacon-fund'), undefined);
  assert.ok(auditRows(db).some((row) => row.action === 'discardOrganizationEdit'
    && row.docPath === `${EDIT_REQUESTS}/beacon-fund`));
  assert.equal((await staff(db, { action: 'discard', organizationId: 'beacon-fund' })).statusCode, 404);
});

test('a second representative of the same organization cannot merge into, or read, the first one’s edit', async () => {
  const db = seed({
    [`${REPRESENTATIVES}/uid-cy`]: { uid: 'uid-cy', email: 'cy@example.org', organizationId: 'beacon-fund' },
  });
  await own(db, 'ada', { action: 'submit', fields: { description: 'From Ada.' } });
  const view = await own(db, 'cy', { action: 'get' });
  assert.equal(view.body.pending, null);
  assert.equal(view.body.otherPending, true);
  const res = await own(db, 'cy', { action: 'submit', fields: { bio: 'From Cy.' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'other-edit-waiting');
  const stored = db.read(EDIT_REQUESTS, 'beacon-fund');
  assert.deepEqual(stored.fields, { description: 'From Ada.' });
  assert.equal(stored.submittedByUid, 'uid-ada');
  // Ada's own view still shows her edit.
  const ada = await own(db, 'ada', { action: 'get' });
  assert.deepEqual(ada.body.pending.fields, { description: 'From Ada.' });
  assert.equal(ada.body.otherPending, false);
});

// Codex review on #540: the editor must adopt what apply actually wrote. A
// transaction that retries reads the queue again, so the values can be a
// newer edit than the one the page listed.
test('apply answers with the values it wrote to the draft, read inside its own transaction', async () => {
  const db = seed();
  await own(db, 'ada', { action: 'submit', fields: { description: 'First text.' } });
  // The representative sends again after the page listed the first text,
  // and the first attempt of the apply transaction meets that write.
  let raced = false;
  const runTransaction = db.runTransaction.bind(db);
  db.runTransaction = async (fn, options) => runTransaction(async (tx) => {
    const result = await fn(tx);
    if (!raced) {
      raced = true;
      await own(db, 'ada', { action: 'submit', fields: { description: '  Newer text.  ', url: 'HTTPS://Beacon.example.org/new' } });
    }
    return result;
  }, options);
  const res = await staff(db, { action: 'apply', organizationId: 'beacon-fund' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(raced);
  const draft = db.read('cmsOrganizations_drafts', 'beacon-fund');
  assert.equal(draft.description, 'Newer text.');
  assert.deepEqual(res.body.applied, { description: draft.description, url: draft.url });
  assert.deepEqual(res.body.appliedFields, ['description', 'url']);
});
