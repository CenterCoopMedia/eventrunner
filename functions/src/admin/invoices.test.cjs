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
  assert.equal((await call(db, { action: 'issue', invoiceId: ID })).statusCode, 400);
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
