'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createInvoiceAdminHandler, internals: { MAX_SCAN } } = require('./invoices.cjs');

const NOW = new Date('2026-10-20T12:00:00Z');
const ID = 'inv_0123456789abcdef0123';
const OTHER_ID = 'inv_fedcba98765432100000';
const getConfig = async () => ({ event: { historicalDemo: false } });
const auth = { async verifyIdToken(token) {
  if (token === 'missing') throw new Error('unauthorized');
  return { uid: token, email: `${token}@example.org`, email_verified: token !== 'unverified' };
} };

function dbFor(extra = {}) {
  return makeFakeDb({
    'config/bootstrap': { adminEmails: ['operator@example.org'], staffEmails: ['staff@example.org'] },
    'config/event': { historicalDemo: false },
    ...extra,
  });
}
function resOf() {
  return { statusCode: 0, body: null, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
// Every request moves the clock one second, so the list order is fixed.
let clock = 0;
const now = () => new Date(NOW.getTime() + (clock += 1000));
async function call(db, body, user = 'staff', method = 'POST') {
  const res = resOf();
  const handler = createInvoiceAdminHandler({ db, auth, getConfig, now, log: { error() {} } });
  await handler({ method, body, headers: { authorization: `Bearer ${user}` } }, res);
  return res;
}

function draft(patch = {}) {
  return {
    billTo: { organizationId: 'example-press', name: 'Example Press', contactName: 'Ada Example', email: 'billing@example.org', address: '1 Main Street' },
    reference: 'PO-77',
    lines: [{ description: 'Presenting package', quantity: 2, unitAmount: 250000 }],
    adjustments: [{ kind: 'discount', label: 'Early commitment', amount: 50000 }, { kind: 'tax', label: 'Sales tax', amount: 31500 }],
    dueDate: '2026-11-30',
    notes: 'Thank you.',
    ...patch,
  };
}
async function audits(db) {
  return (await db.collection('admin_logs').get()).docs.map((snap) => snap.data());
}

test('only verified admins reach invoices, and settings changes need an operator', async () => {
  const db = dbFor();
  for (const user of ['stranger', 'unverified']) {
    assert.equal((await call(db, { action: 'list' }, user)).statusCode, 403);
  }
  assert.equal((await call(db, { action: 'list' }, 'missing')).statusCode, 401);
  assert.equal((await call(db, { action: 'saveSettings', expectedRevision: 0, settings: {} })).statusCode, 403);
  assert.equal((await call(db, { action: 'saveSettings', expectedRevision: 0, settings: {} }, 'operator')).statusCode, 200);
  const res = await call(db, { action: 'list' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal((await call(db, { action: 'list' }, 'staff', 'GET')).statusCode, 405);
  assert.equal((await call(db, { action: 'refund', invoiceId: ID })).statusCode, 400);
});

test('a draft is saved with server totals, reopened, and its totals recomputed', async () => {
  const db = dbFor();
  const saved = await call(db, {
    action: 'saveDraft', invoiceId: ID, expectedRevision: 0,
    invoice: { ...draft(), totals: { total: 1 }, status: 'paid', number: 'INV-0099', currency: 'gbp' },
  });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const { invoice } = saved.body;
  assert.equal(invoice.id, ID);
  assert.equal(invoice.status, 'draft');
  assert.equal(invoice.number, null);
  assert.equal(invoice.currency, 'usd');
  assert.equal(invoice.revision, 1);
  assert.deepEqual(invoice.totals, { subtotal: 500000, discountTotal: 50000, taxTotal: 31500, total: 481500 });
  assert.equal(invoice.lines[0].amount, 500000);

  const reopened = await call(db, { action: 'get', invoiceId: ID });
  assert.equal(reopened.statusCode, 200);
  assert.deepEqual(reopened.body.invoice, invoice);

  // A change to one line recomputes every figure on the server.
  const changed = await call(db, {
    action: 'saveDraft', invoiceId: ID, expectedRevision: 1,
    invoice: draft({ lines: [{ description: 'Presenting package', quantity: 3, unitAmount: 250000 }] }),
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.body.invoice.revision, 2);
  assert.deepEqual(changed.body.invoice.totals, { subtotal: 750000, discountTotal: 50000, taxTotal: 31500, total: 731500 });
  const stored = (await db.collection('invoices').doc(ID).get()).data();
  assert.equal(stored.totals.total, 731500);
  assert.equal(stored.createdBy, 'staff');

  const rows = await audits(db);
  assert.deepEqual(rows.map((row) => row.action), ['invoices.draft-created', 'invoices.draft-saved']);
  assert.equal(rows[0].docPath, `invoices/${ID}`);
  assert.equal(rows[0].actorUid, 'staff');
});

test('the invoice currency is the catalog currency, then the settings currency, then USD', async () => {
  const withSettings = dbFor({ 'invoice_settings/current': { prefix: 'INV', currency: 'eur', revision: 1 } });
  assert.equal((await call(withSettings, { action: 'saveDraft', invoiceId: ID, expectedRevision: 0, invoice: draft() })).body.invoice.currency, 'eur');
  const withCatalog = dbFor({ 'invoice_settings/current': { prefix: 'INV', currency: 'eur', revision: 1 }, 'ticket_catalog/current': { currency: 'cad' } });
  assert.equal((await call(withCatalog, { action: 'saveDraft', invoiceId: ID, expectedRevision: 0, invoice: draft() })).body.invoice.currency, 'cad');
  // A draft keeps the currency it was created with.
  await withCatalog.collection('ticket_catalog').doc('current').set({ currency: 'aud' });
  assert.equal((await call(withCatalog, { action: 'saveDraft', invoiceId: ID, expectedRevision: 1, invoice: draft() })).body.invoice.currency, 'cad');
});

test('a stale revision is refused and leaves the draft and the audit log unchanged', async () => {
  const db = dbFor();
  await call(db, { action: 'saveDraft', invoiceId: ID, expectedRevision: 0, invoice: draft() });
  const before = (await db.collection('invoices').doc(ID).get()).data();
  for (const expectedRevision of [0, 2]) {
    const res = await call(db, { action: 'saveDraft', invoiceId: ID, expectedRevision, invoice: draft({ notes: 'Other' }) });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, 'conflict');
  }
  assert.deepEqual((await db.collection('invoices').doc(ID).get()).data(), before);
  assert.equal((await audits(db)).length, 1);
  assert.equal((await call(db, { action: 'saveDraft', invoiceId: ID, invoice: draft() })).statusCode, 400);
  assert.equal((await call(db, { action: 'saveDraft', invoiceId: OTHER_ID, expectedRevision: 3, invoice: draft() })).statusCode, 404);
});

test('a draft that fails validation names each field, and a negative total is refused', async () => {
  const db = dbFor();
  const bad = await call(db, {
    action: 'saveDraft', invoiceId: ID, expectedRevision: 0,
    invoice: draft({ billTo: { name: ' ' }, lines: [{ description: 'Item', quantity: 0, unitAmount: 1 }] }),
  });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /^Invalid invoice: billTo\.name: .+; lines\.0\.quantity: /);
  const negative = await call(db, {
    action: 'saveDraft', invoiceId: ID, expectedRevision: 0,
    invoice: draft({ adjustments: [{ kind: 'discount', label: 'Too much', amount: 600000 }] }),
  });
  assert.equal(negative.statusCode, 400);
  assert.match(negative.body.error.message, /totals: /);
  assert.equal((await call(db, { action: 'saveDraft', invoiceId: 'INV-1', expectedRevision: 0, invoice: draft() })).statusCode, 400);
  assert.equal((await db.collection('invoices').get()).size, 0);
  assert.equal((await audits(db)).length, 0);
});

test('only a draft can be saved or deleted', async () => {
  const db = dbFor({ [`invoices/${ID}`]: { status: 'issued', number: 'INV-0001', revision: 4, currency: 'usd', lines: [], adjustments: [], totals: { subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0 }, billTo: { name: 'Example' } } });
  const save = await call(db, { action: 'saveDraft', invoiceId: ID, expectedRevision: 4, invoice: draft() });
  assert.equal(save.statusCode, 409);
  assert.match(save.body.error.message, /Only a draft/);
  assert.equal((await call(db, { action: 'deleteDraft', invoiceId: ID, expectedRevision: 4 })).statusCode, 409);
  assert.equal((await db.collection('invoices').doc(ID).get()).data().number, 'INV-0001');
});

test('a draft is deleted with its revision and an audit row', async () => {
  const db = dbFor();
  await call(db, { action: 'saveDraft', invoiceId: ID, expectedRevision: 0, invoice: draft() });
  assert.equal((await call(db, { action: 'deleteDraft', invoiceId: ID, expectedRevision: 0 })).statusCode, 409);
  const res = await call(db, { action: 'deleteDraft', invoiceId: ID, expectedRevision: 1 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { deleted: true, invoiceId: ID });
  assert.equal((await db.collection('invoices').doc(ID).get()).exists, false);
  assert.equal((await audits(db)).at(-1).action, 'invoices.draft-deleted');
  assert.equal((await call(db, { action: 'get', invoiceId: ID })).statusCode, 404);
  assert.equal((await call(db, { action: 'deleteDraft', invoiceId: ID, expectedRevision: 1 })).statusCode, 404);
});

test('a read-only demo refuses every write and still answers reads', async () => {
  const db = dbFor({ 'config/event': { historicalDemo: true } });
  for (const body of [
    { action: 'saveDraft', invoiceId: ID, expectedRevision: 0, invoice: draft() },
    { action: 'deleteDraft', invoiceId: ID, expectedRevision: 1 },
  ]) {
    const res = await call(db, body);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'read-only-demo');
  }
  assert.equal((await call(db, { action: 'saveSettings', expectedRevision: 0, settings: {} }, 'operator')).body.error.code, 'read-only-demo');
  assert.equal((await call(db, { action: 'list' })).statusCode, 200);
  assert.equal((await call(db, { action: 'settings' })).statusCode, 200);
  assert.equal((await db.collection('invoices').get()).size, 0);
});

test('the list filters by status and search, pages, and cleans stored text on read', async () => {
  const db = dbFor();
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    const id = `inv_${String(index).padStart(20, '0')}`;
    ids.push(id);
    await call(db, { action: 'saveDraft', invoiceId: id, expectedRevision: 0, invoice: draft({ billTo: { name: index === 2 ? 'Second Example' : `Sponsor ${index}` } }) });
  }
  await db.collection('invoices').doc(ids[4]).set({ ...(await db.collection('invoices').doc(ids[4]).get()).data(), status: 'paid', number: 'INV-0004' });
  await db.collection('invoices').doc(ids[3]).set({ ...(await db.collection('invoices').doc(ids[3]).get()).data(), billTo: { name: 'Hidden\u202e text' } });

  const all = await call(db, { action: 'list' });
  assert.deepEqual(all.body.invoices.map((row) => row.id), [...ids].reverse());
  assert.equal(all.body.invoices[1].billTo.name, 'Hidden text');
  assert.equal(all.body.nextCursor, null);
  assert.deepEqual((await call(db, { action: 'list', status: 'paid' })).body.invoices.map((row) => row.id), [ids[4]]);
  assert.deepEqual((await call(db, { action: 'list', search: 'second' })).body.invoices.map((row) => row.id), [ids[2]]);
  assert.deepEqual((await call(db, { action: 'list', search: 'inv-0004' })).body.invoices.map((row) => row.id), [ids[4]]);
  assert.equal((await call(db, { action: 'list', status: 'lost' })).statusCode, 400);

  const first = await call(db, { action: 'list', limit: 2 });
  assert.deepEqual(first.body.invoices.map((row) => row.id), [ids[4], ids[3]]);
  const second = await call(db, { action: 'list', limit: 2, cursor: first.body.nextCursor });
  assert.deepEqual(second.body.invoices.map((row) => row.id), [ids[2], ids[1]]);
  assert.equal((await call(db, { action: 'list', cursor: 'not a cursor' })).statusCode, 400);
  // The list row carries the figures it shows, not the lines.
  assert.equal('lines' in all.body.invoices[0], false);
  assert.equal(all.body.invoices[0].totals.total, 481500);
});

test('the list scans a bounded window', async () => {
  assert.equal(MAX_SCAN, 250);
  const seed = {};
  for (let index = 0; index < MAX_SCAN + 5; index += 1) {
    const id = `inv_${String(index).padStart(20, '0')}`;
    const at = new Date(NOW.getTime() + index * 1000);
    seed[`invoices/${id}`] = { status: 'draft', number: null, currency: 'usd', billTo: { name: `Sponsor ${index}` }, totals: { total: 0 }, revision: 1, createdAt: at, updatedAt: at, listKey: `${at.toISOString()}|${id}` };
  }
  const db = dbFor(seed);
  const res = await call(db, { action: 'list', search: 'no such sponsor', limit: 50 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.invoices, []);
  assert.notEqual(res.body.nextCursor, null);
});

test('settings default for a new deployment and an operator save keeps values out of the audit log', async () => {
  const db = dbFor({ 'ticket_catalog/current': { currency: 'gbp' } });
  const empty = await call(db, { action: 'settings' });
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.body.revision, 0);
  assert.equal(empty.body.settings.prefix, 'INV');
  assert.equal(empty.body.invoiceCurrency, 'gbp');
  assert.equal(empty.body.nextNumber, 'INV-0001');
  assert.equal(empty.body.canEdit, false);
  assert.equal((await call(db, { action: 'settings' }, 'operator')).body.canEdit, true);

  const settings = { prefix: 'SPONSOR', currency: 'usd', issuerName: 'Example Events', issuerAddress: '2 High Street', taxId: 'TAX-1', paymentInstructions: 'Account 000000.' };
  const saved = await call(db, { action: 'saveSettings', expectedRevision: 0, settings }, 'operator');
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.nextNumber, 'SPONSOR-0001');
  assert.equal(saved.body.settings.paymentInstructions, 'Account 000000.');
  assert.equal((await call(db, { action: 'saveSettings', expectedRevision: 0, settings }, 'operator')).statusCode, 409);
  assert.equal((await call(db, { action: 'saveSettings', expectedRevision: 1, settings: { prefix: 'bad prefix' } }, 'operator')).statusCode, 400);

  const [row] = await audits(db);
  assert.equal(row.action, 'invoices.settings-saved');
  assert.equal(row.docPath, 'invoice_settings/current');
  assert.deepEqual(row.details.fields.sort(), ['currency', 'issuerAddress', 'issuerName', 'paymentInstructions', 'prefix', 'taxId']);
  assert.doesNotMatch(JSON.stringify(row), /000000|High Street/);
});

// ------------------------------------------------------------ part 3: issue, paid, void, duplicate (#209)

const SETTINGS = {
  prefix: 'INV', currency: '', issuerName: 'Example Events', issuerAddress: '2 High Street\nExample Town',
  issuerEmail: 'billing@example.org', taxId: 'TAX-1', paymentInstructions: 'Account 000000.', revision: 1,
};
function issuedDb(extra = {}) {
  return dbFor({ 'config/event': { historicalDemo: false, timezone: 'America/New_York' }, 'invoice_settings/current': SETTINGS, ...extra });
}
async function saveNew(db, id = ID, patch = {}) {
  const res = await call(db, { action: 'saveDraft', invoiceId: id, expectedRevision: 0, invoice: draft(patch) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.invoice;
}

test('issue assigns the next number, freezes the totals and copies the issuer', async () => {
  const db = issuedDb();
  await saveNew(db);
  const res = await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const { invoice } = res.body;
  assert.equal(invoice.status, 'issued');
  assert.equal(invoice.number, 'INV-0001');
  assert.equal(invoice.revision, 2);
  // The clock reads 2026-10-20 in New York.
  assert.equal(invoice.issueDate, '2026-10-20');
  assert.deepEqual(invoice.issuer, {
    name: 'Example Events', address: '2 High Street\nExample Town', email: 'billing@example.org',
    taxId: 'TAX-1', paymentInstructions: 'Account 000000.',
  });
  assert.deepEqual(invoice.totals, { subtotal: 500000, discountTotal: 50000, taxTotal: 31500, total: 481500 });
  assert.equal((await db.collection('invoice_counters').doc('current').get()).data().lastNumber, 1);

  // Later settings edits do not reach an issued invoice.
  await db.collection('invoice_settings').doc('current').set({ ...SETTINGS, issuerName: 'Renamed', revision: 2 });
  const reopened = (await call(db, { action: 'get', invoiceId: ID })).body.invoice;
  assert.equal(reopened.issuer.name, 'Example Events');

  // An issued invoice cannot change, be deleted or be issued again.
  assert.equal((await call(db, { action: 'saveDraft', invoiceId: ID, expectedRevision: 2, invoice: draft() })).statusCode, 409);
  assert.equal((await call(db, { action: 'deleteDraft', invoiceId: ID, expectedRevision: 2 })).statusCode, 409);
  const again = await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 2 });
  assert.equal(again.statusCode, 409);
  assert.equal((await db.collection('invoice_counters').doc('current').get()).data().lastNumber, 1);

  const rows = await audits(db);
  assert.deepEqual(rows.map((row) => row.action), ['invoices.draft-created', 'invoices.issued']);
  assert.deepEqual(rows[1].details, { revision: 2, number: 'INV-0001', sequence: 1, total: 481500, currency: 'usd' });
});

test('issue refuses a stale revision, a draft with no line, a due date before the issue date, and no issuer', async () => {
  const db = issuedDb();
  await saveNew(db);
  assert.equal((await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 0 })).statusCode, 409);
  assert.equal((await call(db, { action: 'issue', invoiceId: ID })).statusCode, 400);
  assert.equal((await call(db, { action: 'issue', invoiceId: OTHER_ID, expectedRevision: 1 })).statusCode, 404);

  await saveNew(db, OTHER_ID, { lines: [], adjustments: [], dueDate: '2026-10-01' });
  const empty = await call(db, { action: 'issue', invoiceId: OTHER_ID, expectedRevision: 1 });
  assert.equal(empty.statusCode, 400);
  assert.match(empty.body.error.message, /^Invalid invoice: lines: Add at least one line before issuing\.; dueDate: The due date is before the issue date/);

  const noIssuer = issuedDb({ 'invoice_settings/current': { prefix: 'INV', revision: 1 } });
  await saveNew(noIssuer);
  const refused = await call(noIssuer, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.body.error.message, /settings\.issuerName: /);

  for (const target of [db, noIssuer]) {
    assert.equal((await target.collection('invoice_counters').doc('current').get()).exists, false);
    assert.deepEqual((await audits(target)).map((row) => row.action).filter((action) => action !== 'invoices.draft-created'), []);
  }
});

test('numbers have no gaps when drafts are issued at the same time, and one draft never takes two numbers', async () => {
  const db = issuedDb({ 'invoice_counters/current': { lastNumber: 6 } });
  const ids = [];
  for (let index = 0; index < 4; index += 1) {
    const id = `inv_${String(index).padStart(20, '0')}`;
    ids.push(id);
    await saveNew(db, id);
  }
  // Four drafts at once, and the first one twice more.
  const results = await Promise.all([
    ...ids.map((id) => call(db, { action: 'issue', invoiceId: id, expectedRevision: 1 })),
    call(db, { action: 'issue', invoiceId: ids[0], expectedRevision: 1 }),
    call(db, { action: 'issue', invoiceId: ids[0], expectedRevision: 1 }),
  ]);
  const ok = results.filter((res) => res.statusCode === 200);
  assert.equal(ok.length, 4);
  assert.deepEqual(results.filter((res) => res.statusCode !== 200).map((res) => res.statusCode), [409, 409]);
  assert.deepEqual(ok.map((res) => res.body.invoice.number).sort(), ['INV-0007', 'INV-0008', 'INV-0009', 'INV-0010']);
  assert.equal((await db.collection('invoice_counters').doc('current').get()).data().lastNumber, 10);
  const stored = await Promise.all(ids.map(async (id) => (await db.collection('invoices').doc(id).get()).data()));
  assert.deepEqual(stored.map((row) => row.sequence).sort((a, b) => a - b), [7, 8, 9, 10]);
  assert.equal((await audits(db)).filter((row) => row.action === 'invoices.issued').length, 4);
});

test('issue refuses a damaged counter and a number another invoice already holds', async () => {
  const damaged = issuedDb({ 'invoice_counters/current': { lastNumber: 'seven' } });
  await saveNew(damaged);
  const res = await call(damaged, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error.message, /counter/);

  const behind = issuedDb({ [`invoices/${OTHER_ID}`]: { status: 'issued', number: 'INV-0001', sequence: 1, revision: 2 } });
  await saveNew(behind);
  const taken = await call(behind, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  assert.equal(taken.statusCode, 409);
  assert.match(taken.body.error.message, /INV-0001 is already used/);
  assert.equal((await behind.collection('invoices').doc(ID).get()).data().status, 'draft');
});

test('the prefix in the settings at issue time names the number', async () => {
  const db = issuedDb({ 'invoice_settings/current': { ...SETTINGS, prefix: 'SPONSOR' }, 'invoice_counters/current': { lastNumber: 41 } });
  await saveNew(db);
  assert.equal((await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 })).body.invoice.number, 'SPONSOR-0042');
});

test('mark paid records the date, method and note on an issued invoice only', async () => {
  const db = issuedDb();
  await saveNew(db);
  const payment = { paidOn: '2026-10-19', method: 'bank-transfer', note: 'Ref 42' };
  assert.equal((await call(db, { action: 'markPaid', invoiceId: ID, expectedRevision: 1, payment })).statusCode, 409);
  await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 });

  const future = await call(db, { action: 'markPaid', invoiceId: ID, expectedRevision: 2, payment: { ...payment, paidOn: '2026-10-21' } });
  assert.equal(future.statusCode, 400);
  assert.match(future.body.error.message, /^Invalid payment: paidOn: /);
  assert.equal((await call(db, { action: 'markPaid', invoiceId: ID, expectedRevision: 1, payment })).statusCode, 409);

  const res = await call(db, { action: 'markPaid', invoiceId: ID, expectedRevision: 2, payment });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.invoice.status, 'paid');
  assert.deepEqual(res.body.invoice.payment, { paidOn: '2026-10-19', method: 'bank-transfer', note: 'Ref 42', recordedBy: 'staff', recordedAt: res.body.invoice.payment.recordedAt });
  assert.equal(res.body.invoice.number, 'INV-0001');
  assert.equal((await call(db, { action: 'markPaid', invoiceId: ID, expectedRevision: 3, payment })).statusCode, 409);
  const row = (await audits(db)).at(-1);
  assert.equal(row.action, 'invoices.paid');
  assert.deepEqual(row.details, { revision: 3, number: 'INV-0001', paidOn: '2026-10-19', method: 'bank-transfer' });
});

test('only an operator voids, with a reason; the number stays used and the invoice stays locked', async () => {
  const db = issuedDb();
  await saveNew(db);
  await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  const staff = await call(db, { action: 'void', invoiceId: ID, expectedRevision: 2, reason: 'Wrong amount' });
  assert.equal(staff.statusCode, 403);
  assert.equal((await call(db, { action: 'void', invoiceId: ID, expectedRevision: 2, reason: ' ' }, 'operator')).statusCode, 400);
  assert.equal((await call(db, { action: 'void', invoiceId: ID, expectedRevision: 1, reason: 'Wrong amount' }, 'operator')).statusCode, 409);

  const res = await call(db, { action: 'void', invoiceId: ID, expectedRevision: 2, reason: 'Wrong amount' }, 'operator');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.invoice.status, 'void');
  assert.equal(res.body.invoice.number, 'INV-0001');
  assert.equal(res.body.invoice.voided.reason, 'Wrong amount');
  assert.equal(res.body.invoice.voided.from, 'issued');
  assert.equal(res.body.invoice.voided.by, 'operator');

  // Nothing moves a void invoice, and its number is never handed out again.
  for (const body of [
    { action: 'void', invoiceId: ID, expectedRevision: 3, reason: 'Again' },
    { action: 'markPaid', invoiceId: ID, expectedRevision: 3, payment: { paidOn: '2026-10-19', method: 'cash' } },
    { action: 'issue', invoiceId: ID, expectedRevision: 3 },
    { action: 'saveDraft', invoiceId: ID, expectedRevision: 3, invoice: draft() },
    { action: 'deleteDraft', invoiceId: ID, expectedRevision: 3 },
  ]) {
    assert.equal((await call(db, body, 'operator')).statusCode, 409, body.action);
  }
  await saveNew(db, OTHER_ID);
  assert.equal((await call(db, { action: 'issue', invoiceId: OTHER_ID, expectedRevision: 1 })).body.invoice.number, 'INV-0002');
  const voided = (await audits(db)).find((row) => row.action === 'invoices.voided');
  assert.deepEqual(voided.details, { revision: 3, number: 'INV-0001', from: 'issued', reason: 'Wrong amount' });
  assert.equal(voided.actorUid, 'operator');
});

test('a paid invoice can be voided by an operator and keeps its payment record', async () => {
  const db = issuedDb();
  await saveNew(db);
  await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  await call(db, { action: 'markPaid', invoiceId: ID, expectedRevision: 2, payment: { paidOn: '2026-10-20', method: 'card' } });
  const res = await call(db, { action: 'void', invoiceId: ID, expectedRevision: 3, reason: 'Refunded' }, 'operator');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.voided.from, 'paid');
  assert.equal(res.body.invoice.payment.method, 'card');
  // A draft is deleted, not voided.
  await saveNew(db, OTHER_ID);
  assert.equal((await call(db, { action: 'void', invoiceId: OTHER_ID, expectedRevision: 1, reason: 'x' }, 'operator')).statusCode, 409);
});

test('duplicate copies an invoice into a new draft with no number, once per new id', async () => {
  const db = issuedDb();
  await saveNew(db);
  await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  await call(db, { action: 'void', invoiceId: ID, expectedRevision: 2, reason: 'Wrong amount' }, 'operator');

  const res = await call(db, { action: 'duplicate', invoiceId: ID, newInvoiceId: OTHER_ID });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const copy = res.body.invoice;
  assert.equal(copy.id, OTHER_ID);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.number, null);
  assert.equal(copy.revision, 1);
  assert.equal(copy.issuer, null);
  assert.equal(copy.issueDate, null);
  assert.equal(copy.voided, null);
  assert.equal(copy.dueDate, null);
  assert.equal(copy.currency, 'usd');
  assert.deepEqual(copy.duplicatedFrom, { invoiceId: ID, number: 'INV-0001' });
  const source = (await call(db, { action: 'get', invoiceId: ID })).body.invoice;
  assert.deepEqual(copy.lines, source.lines);
  assert.deepEqual(copy.adjustments, source.adjustments);
  assert.deepEqual(copy.billTo, source.billTo);
  assert.deepEqual(copy.totals, source.totals);

  // A retry with the same new id answers the same draft; another source or a used id is refused.
  const retry = await call(db, { action: 'duplicate', invoiceId: ID, newInvoiceId: OTHER_ID });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.invoice.revision, 1);
  assert.equal((await call(db, { action: 'duplicate', invoiceId: OTHER_ID, newInvoiceId: ID })).statusCode, 409);
  assert.equal((await call(db, { action: 'duplicate', invoiceId: ID, newInvoiceId: ID })).statusCode, 400);
  assert.equal((await call(db, { action: 'duplicate', invoiceId: ID, newInvoiceId: 'bad' })).statusCode, 400);
  assert.equal((await call(db, { action: 'duplicate', invoiceId: 'inv_99999999999999999999', newInvoiceId: 'inv_88888888888888888888' })).statusCode, 404);

  // The copy is an ordinary draft: it saves and takes the next number.
  assert.equal((await call(db, { action: 'issue', invoiceId: OTHER_ID, expectedRevision: 1 })).body.invoice.number, 'INV-0002');
  const rows = (await audits(db)).filter((row) => row.action === 'invoices.duplicated');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].details, { from: ID, fromNumber: 'INV-0001', revision: 1 });
  assert.equal(rows[0].invoiceId, OTHER_ID);
});

test('a read-only demo refuses issue, paid, void and duplicate', async () => {
  const db = issuedDb({ [`invoices/${ID}`]: { status: 'draft', revision: 1, currency: 'usd', ...draft() } });
  await db.collection('config').doc('event').set({ historicalDemo: true });
  for (const [body, user] of [
    [{ action: 'issue', invoiceId: ID, expectedRevision: 1 }, 'staff'],
    [{ action: 'markPaid', invoiceId: ID, expectedRevision: 1, payment: { paidOn: '2026-10-19', method: 'cash' } }, 'staff'],
    [{ action: 'void', invoiceId: ID, expectedRevision: 1, reason: 'x' }, 'operator'],
    [{ action: 'duplicate', invoiceId: ID, newInvoiceId: OTHER_ID }, 'staff'],
  ]) {
    const res = await call(db, body, user);
    assert.equal(res.statusCode, 403, body.action);
    assert.equal(res.body.error.code, 'read-only-demo');
  }
  assert.equal((await db.collection('invoice_counters').doc('current').get()).exists, false);
  assert.equal((await audits(db)).length, 0);
});

test('a demo switched on inside the issue transaction still refuses it', async () => {
  const db = issuedDb();
  await saveNew(db);
  // The write policy is part of the transaction's read set: a switch
  // between the first read and the commit retries and is refused.
  db.beforeCommit = async () => { await db.collection('config').doc('event').set({ historicalDemo: true, timezone: 'America/New_York' }); };
  const res = await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  assert.equal(res.statusCode, 403);
  assert.equal((await db.collection('invoices').doc(ID).get()).data().status, 'draft');
  assert.equal((await db.collection('invoice_counters').doc('current').get()).exists, false);
});

test('every invoice answer says whether the caller may void it', async () => {
  const db = issuedDb();
  await saveNew(db);
  assert.equal((await call(db, { action: 'get', invoiceId: ID })).body.canVoid, false);
  assert.equal((await call(db, { action: 'get', invoiceId: ID }, 'operator')).body.canVoid, true);
  assert.equal((await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 })).body.canVoid, false);
  assert.equal((await call(db, { action: 'void', invoiceId: ID, expectedRevision: 2, reason: 'x' }, 'operator')).body.canVoid, true);
  assert.equal('canVoid' in (await call(db, { action: 'list' })).body, false);
});

test('issue refuses invoice settings that no longer validate, and a draft whose currency is not supported', async () => {
  const badPrefix = issuedDb({ 'invoice_settings/current': { ...SETTINGS, prefix: 'bad prefix "x"' } });
  await saveNew(badPrefix);
  const refused = await call(badPrefix, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  assert.equal(refused.statusCode, 409);
  assert.match(refused.body.error.message, /invoice settings/);
  assert.equal((await badPrefix.collection('invoice_counters').doc('current').get()).exists, false);

  const odd = issuedDb({ [`invoices/${ID}`]: { ...draft(), status: 'draft', number: null, currency: 'xyz', revision: 1, totals: {} } });
  const res = await call(odd, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error.message, /currency/);
  assert.equal((await odd.collection('invoices').doc(ID).get()).data().status, 'draft');
});

test('only an operator reopens a paid invoice, with a reason, and the payment moves to the history', async () => {
  const db = issuedDb();
  await saveNew(db);
  await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  // An issued invoice has no payment to reopen.
  assert.equal((await call(db, { action: 'reopen', invoiceId: ID, expectedRevision: 2, reason: 'x' }, 'operator')).statusCode, 409);
  await call(db, { action: 'markPaid', invoiceId: ID, expectedRevision: 2, payment: { paidOn: '2026-10-19', method: 'check', note: 'Check 1042' } });

  assert.equal((await call(db, { action: 'reopen', invoiceId: ID, expectedRevision: 3, reason: 'Check bounced' })).statusCode, 403);
  const blank = await call(db, { action: 'reopen', invoiceId: ID, expectedRevision: 3, reason: ' ' }, 'operator');
  assert.equal(blank.statusCode, 400);
  assert.match(blank.body.error.message, /^Invalid reopen: reason: /);
  assert.equal((await call(db, { action: 'reopen', invoiceId: ID, expectedRevision: 2, reason: 'Check bounced' }, 'operator')).statusCode, 409);

  const res = await call(db, { action: 'reopen', invoiceId: ID, expectedRevision: 3, reason: 'Check bounced' }, 'operator');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const { invoice } = res.body;
  assert.equal(invoice.status, 'issued');
  assert.equal(invoice.number, 'INV-0001');
  assert.equal(invoice.payment, null);
  assert.equal(invoice.revision, 4);
  assert.equal(res.body.canReopen, true);
  assert.equal(invoice.paymentHistory.length, 1);
  assert.deepEqual(
    { ...invoice.paymentHistory[0], recordedAt: null, reopenedAt: null },
    { paidOn: '2026-10-19', method: 'check', note: 'Check 1042', recordedAt: null, recordedBy: 'staff', reopenedAt: null, reopenedBy: 'operator', reason: 'Check bounced' },
  );

  // It can be paid again, and a second reopen keeps both payments.
  await call(db, { action: 'markPaid', invoiceId: ID, expectedRevision: 4, payment: { paidOn: '2026-10-20', method: 'bank-transfer' } });
  const again = await call(db, { action: 'reopen', invoiceId: ID, expectedRevision: 5, reason: 'Wrong invoice' }, 'operator');
  assert.deepEqual(again.body.invoice.paymentHistory.map((entry) => entry.method), ['check', 'bank-transfer']);
  assert.equal((await db.collection('invoice_counters').doc('current').get()).data().lastNumber, 1);

  const rows = (await audits(db)).filter((row) => row.action === 'invoices.reopened');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].details, { revision: 4, number: 'INV-0001', reason: 'Check bounced', paidOn: '2026-10-19', method: 'check' });
  assert.equal(rows[0].actorUid, 'operator');
  assert.equal((await call(db, { action: 'get', invoiceId: ID })).body.canReopen, false);
});

test('reopen refuses a void invoice, a draft and a read-only demo', async () => {
  const db = issuedDb();
  await saveNew(db);
  assert.equal((await call(db, { action: 'reopen', invoiceId: ID, expectedRevision: 1, reason: 'x' }, 'operator')).statusCode, 409);
  await call(db, { action: 'issue', invoiceId: ID, expectedRevision: 1 });
  await call(db, { action: 'markPaid', invoiceId: ID, expectedRevision: 2, payment: { paidOn: '2026-10-19', method: 'cash' } });
  await call(db, { action: 'void', invoiceId: ID, expectedRevision: 3, reason: 'Refunded' }, 'operator');
  const voided = await call(db, { action: 'reopen', invoiceId: ID, expectedRevision: 4, reason: 'x' }, 'operator');
  assert.equal(voided.statusCode, 409);
  assert.match(voided.body.error.message, /void/);
  assert.equal((await db.collection('invoices').doc(ID).get()).data().payment.method, 'cash');

  const demo = issuedDb({ [`invoices/${OTHER_ID}`]: { ...draft(), status: 'paid', number: 'INV-0009', currency: 'usd', revision: 3, payment: { paidOn: '2026-10-19', method: 'cash', note: '' } } });
  await demo.collection('config').doc('event').set({ historicalDemo: true });
  const res = await call(demo, { action: 'reopen', invoiceId: OTHER_ID, expectedRevision: 3, reason: 'x' }, 'operator');
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'read-only-demo');
  assert.equal((await demo.collection('invoices').doc(OTHER_ID).get()).data().status, 'paid');
  assert.equal((await audits(demo)).length, 0);
});
