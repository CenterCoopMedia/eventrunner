'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createExportEventDataHandler, internals: { DATASETS, DATASET_NAMES, amount, readRequest } } = require('./dataExport.cjs');
const { ADMIN, STAFF, BOOTSTRAP_DOC, FORBIDDEN, FORBIDDEN_VALUES, exportSeed } = require('./exportFixture.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-10-01T12:00:00.000Z');

const auth = {
  async verifyIdToken(token) {
    const table = {
      admin: { uid: 'admin-1', email: ADMIN, email_verified: true },
      staff: { uid: 'staff-1', email: STAFF, email_verified: true },
      visitor: { uid: 'uid-cy', email: 'cy@example.com', email_verified: true },
    };
    if (!table[token]) throw new Error('invalid token');
    return table[token];
  },
};

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

const req = (token, body, method = 'POST') => ({
  method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

function setup(overrides = {}) {
  const db = makeFakeDb(exportSeed());
  const seed = exportSeed();
  const getConfig = async () => ({ bootstrap: BOOTSTRAP_DOC, event: seed['config/event'], badges: seed['config/badges'], features: {} });
  const handler = createExportEventDataHandler({ db, auth, getConfig, now: () => T0, log: QUIET, ...overrides });
  return { db, handler };
}

async function run(handler, token, body) {
  const res = makeRes();
  await handler(req(token, body), res);
  return res;
}

/** RFC 4180 reader: BOM, every cell quoted, CRLF records. */
function parseCsv(text) {
  assert.ok(text.startsWith('\uFEFF'), 'the file starts with a byte-order mark');
  const body = text.slice(1);
  assert.ok(body.endsWith('\r\n'));
  const rows = [];
  let row = [];
  let i = 0;
  while (i < body.length) {
    assert.equal(body[i], '"', `every cell is quoted (offset ${i})`);
    i += 1;
    let cell = '';
    for (;;) {
      if (body[i] === '"' && body[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (body[i] === '"') { i += 1; break; }
      cell += body[i];
      i += 1;
    }
    row.push(cell);
    if (body[i] === ',') { i += 1; continue; }
    assert.equal(body.slice(i, i + 2), '\r\n');
    i += 2;
    rows.push(row);
    row = [];
  }
  return rows;
}

const asObjects = (rows) => rows.slice(1).map((cells) => Object.fromEntries(rows[0].map((h, i) => [h, cells[i]])));

function assertNoSecrets(text) {
  for (const word of [...FORBIDDEN, ...FORBIDDEN_VALUES]) assert.ok(!text.includes(word), `the file must not contain ${word}: ${text}`);
}

test('readRequest names a missing dataset, an unknown one, and an extra key', () => {
  assert.deepEqual(readRequest({}), { ok: false, errors: [`dataset: must be one of ${DATASET_NAMES.join(', ')}.`] });
  assert.equal(readRequest({ dataset: 'users' }).ok, false);
  assert.match(readRequest({ dataset: 'sessions', where: 'x' }).errors[0], /^where: is not accepted/);
  assert.deepEqual(readRequest({ dataset: 'orders' }), { ok: true, name: 'orders' });
  assert.equal(readRequest([]).ok, false);
});

test('each dataset states its tier: orders and admissions are operator only', () => {
  assert.deepEqual(
    Object.fromEntries(DATASET_NAMES.map((name) => [name, DATASETS[name].tier])),
    { sessions: 'staff', speakers: 'staff', organizations: 'staff', orders: 'operator', admissions: 'operator' },
  );
});

test('amount writes minor units in major units', () => {
  assert.equal(amount(2500, 2), '25.00');
  assert.equal(amount(1000, 0), '1000');
  assert.equal(amount(null, 2), '');
});

test('the gate: no token, a visitor, and a GET are refused before any read', async () => {
  const { handler } = setup();
  assert.equal((await run(handler, null, { dataset: 'sessions' })).statusCode, 401);
  assert.equal((await run(handler, 'visitor', { dataset: 'sessions' })).statusCode, 403);
  const res = makeRes();
  await handler(req('admin', { dataset: 'sessions' }, 'GET'), res);
  assert.equal(res.statusCode, 405);
});

test('staff are refused orders and admissions by name, and no audit row is written', async () => {
  const { db, handler } = setup();
  for (const dataset of ['orders', 'admissions']) {
    const res = await run(handler, 'staff', { dataset });
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error.message, new RegExp(`only an operator can export ${dataset}`));
  }
  assert.equal((await db.collection('admin_logs').where('action', '==', 'exportEventData').get()).size, 0);
});

test('sessions: the current revision with its state, speaker names, the day, and an escaped formula', async () => {
  const { handler } = setup();
  const res = await run(handler, 'staff', { dataset: 'sessions' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.filename, 'sessions-2026-10-01.csv');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  const rows = parseCsv(res.body.csv);
  assert.deepEqual(rows[0], DATASETS.sessions.columns.map((c) => c.header));
  const byId = Object.fromEntries(asObjects(rows).map((row) => [row['Session ID'], row]));
  assert.equal(res.body.rowCount, 4);
  assert.equal(byId['session-keynote'].Title, '\'=HYPERLINK("http://example.test","Keynote")');
  assert.equal(byId['session-keynote'].State, 'Live');
  assert.equal(byId['session-keynote'].Day, 'Main day');
  assert.equal(byId['session-keynote'].Date, '2026-03-27');
  assert.equal(byId['session-keynote']['Time zone'], 'America/New_York');
  assert.equal(byId['session-keynote'].Speakers, 'Ada Quill');
  assert.equal(byId['session-keynote'].Materials, '1');
  assert.equal(byId['session-panel'].Title, 'Data panel (revised)');
  assert.equal(byId['session-panel'].State, 'Live with unpublished changes');
  assert.equal(byId['session-panel'].Speakers, 'Ada Quill; Bo Reyes');
  assert.equal(byId['session-panel']['Part of'], '\'=HYPERLINK("http://example.test","Keynote")');
  assert.equal(byId['session-draft'].State, 'Draft');
  assert.equal(byId['session-panel'].Hidden, 'no');
  assert.equal(byId['pitch-pitch-1'].State, 'Live');
  assert.equal(byId['pitch-pitch-1'].Hidden, 'yes');
  assertNoSecrets(res.body.csv);
});

test('speakers: contact and pipeline fields only, never the account id, invite token or staged edits', async () => {
  const { handler } = setup();
  const res = await run(handler, 'staff', { dataset: 'speakers' });
  assert.equal(res.statusCode, 200);
  const rows = asObjects(parseCsv(res.body.csv));
  const ada = rows.find((row) => row['Speaker ID'] === 'speaker-ada');
  assert.equal(ada.Email, 'ada@example.com');
  assert.equal(ada.Organization, '\'@Ledger');
  assert.equal(ada['Published sessions'], '\'=HYPERLINK("http://example.test","Keynote"); Data panel');
  assert.equal(ada['Social handles'], 'mastodon: @ada@example.social');
  // The photo's Storage path, so a handoff can match the copied files to people.
  assert.equal(ada['Headshot path'], 'speaker-photos/speaker-ada/asset-3/ada.jpg');
  assert.ok(!res.body.csv.includes('uid-ada'), 'no account id');
  // A hidden session is not published: the site does not show it.
  const cy = rows.find((row) => row['Speaker ID'] === 'pitch-pitch-1');
  assert.equal(cy['Published sessions'], '');
  assert.ok(!res.body.csv.includes('PRIVATE-pending-bio'), 'no staged edits');
  assertNoSecrets(res.body.csv);
});

test('organizations: the escaped name, tier and website, the state, and whether the site hides it', async () => {
  const { handler } = setup();
  const res = await run(handler, 'staff', { dataset: 'organizations' });
  const byId = Object.fromEntries(asObjects(parseCsv(res.body.csv)).map((row) => [row['Organization ID'], row]));
  const org = byId['org-ledger'];
  assert.equal(org.Name, '\'+SUM(1,2)');
  assert.equal(org.Tier, 'Sponsor');
  assert.equal(org.Website, 'https://example.org/');
  assert.equal(org.State, 'Live');
  assert.equal(org.Hidden, 'no');
  assert.deepEqual([byId['org-gazette'].State, byId['org-gazette'].Hidden], ['Live', 'yes']);
  // The staff spreadsheet is the admin list: a draft is in it, with its state.
  assert.equal(byId['org-embargo'].State, 'Draft');
  assertNoSecrets(res.body.csv);
});

test('orders: an operator gets amounts in major units and no provider ids, checkout links or purchaser account ids', async () => {
  const { handler } = setup();
  const res = await run(handler, 'admin', { dataset: 'orders' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.filename, 'ticket-orders-2026-10-01.csv');
  const [order] = asObjects(parseCsv(res.body.csv));
  assert.equal(order['Order ID'], 'ord_fixture1');
  assert.equal(order.Mode, 'test');
  assert.equal(order.Total, '50.00');
  assert.equal(order.Tickets, '2 × General');
  assert.equal(order['Ticket IDs'], 'ord_fixture1_0_0; ord_fixture1_0_1');
  assert.ok(!res.body.csv.includes('uid-ada'));
  assertNoSecrets(res.body.csv);
});

test('admissions: holder, status and check-in, an escaped name, and no raw provider record', async () => {
  const { handler } = setup();
  const res = await run(handler, 'admin', { dataset: 'admissions' });
  const rows = asObjects(parseCsv(res.body.csv));
  assert.equal(rows.length, 3);
  const two = rows.find((row) => row['Ticket ID'] === 'ord_fixture1_0_1');
  assert.equal(two['First name'], '\'=Cy');
  assert.equal(two['Claimed by an account'], 'yes');
  assert.equal(two['Checked in'], '2026-03-27T14:00:00.000Z');
  assert.ok(!res.body.csv.includes('uid-cy'));
  const synced = rows.find((row) => row['Ticket ID'] === 'eb-ticket-7');
  assert.equal(synced.Provider, 'eventbrite');
  assert.equal(synced['Order ID'], 'eb-order-3');
  assertNoSecrets(res.body.csv);
});

test('every export writes its admin_logs row with the dataset and the count', async () => {
  const { db, handler } = setup();
  await run(handler, 'staff', { dataset: 'speakers' });
  const logs = await db.collection('admin_logs').where('action', '==', 'exportEventData').get();
  assert.equal(logs.size, 1);
  assert.deepEqual(logs.docs[0].data(), {
    action: 'exportEventData', docPath: 'speakers', uid: 'staff-1', email: STAFF, at: T0,
    details: { dataset: 'speakers', rowCount: 3 },
  });
});

test('no audit row, no file: a failed audit write refuses the export', async () => {
  const { db, handler } = setup();
  const original = db.collection.bind(db);
  db.collection = (name) => {
    const ref = original(name);
    if (name !== 'admin_logs') return ref;
    return { ...ref, doc: () => ({ async set() { throw new Error('write failed'); } }) };
  };
  const res = await run(handler, 'staff', { dataset: 'sessions' });
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error.message, /could not be recorded, so no file was made/);
});

test('a read past the document cap answers 413 with a path the caller can take', async () => {
  const { handler } = setup({ maxDocs: 2 });
  const staff = await run(handler, 'staff', { dataset: 'sessions' });
  assert.equal(staff.statusCode, 413);
  // Staff cannot run the script or download the package: they ask an operator.
  assert.equal(staff.body.error.message, 'This spreadsheet is too large to build here. Ask an operator for the event data package: its file program/sessions.csv holds the live sessions.');
  const operator = await run(handler, 'admin', { dataset: 'organizations' });
  assert.equal(operator.statusCode, 413);
  assert.equal(operator.body.error.message, 'This spreadsheet is too large to build here. Run scripts/export-event-package.cjs from a terminal (docs/operator/archive-handoff.md): its file organizations/organizations.csv holds the live organizations.');
  // The package paths named here are the package's own.
  const { internals: { SECTIONS } } = require('./eventPackage.cjs');
  const paths = SECTIONS.flatMap((section) => section.files.map((file) => file.path));
  for (const name of DATASET_NAMES) assert.ok(paths.includes(DATASETS[name].packagePath), name);
});

test('a page larger than one read page is read in id order, every document once', async () => {
  const seed = { 'config/bootstrap': BOOTSTRAP_DOC };
  for (let i = 0; i < 650; i += 1) {
    seed[`cmsOrganizations/org-${String(i).padStart(4, '0')}`] = { name: `Org ${i}`, visible: true };
  }
  const db = makeFakeDb(seed);
  const handler = createExportEventDataHandler({ db, auth, getConfig: async () => ({ bootstrap: BOOTSTRAP_DOC }), now: () => T0, log: QUIET });
  const res = await run(handler, 'staff', { dataset: 'organizations' });
  assert.equal(res.body.rowCount, 650);
  const ids = asObjects(parseCsv(res.body.csv)).map((row) => row['Organization ID']);
  assert.equal(new Set(ids).size, 650);
  assert.deepEqual(ids, [...ids].sort());
});
