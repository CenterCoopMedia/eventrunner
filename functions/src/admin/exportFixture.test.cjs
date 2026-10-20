'use strict';

// The export fixture must hold what the real writers store (issue #329).
// A made-up field once let the package tests pass while every converted
// pitch exported an empty link. These checks run each fixture document
// through its writer's own validator or builder, so a field no code writes
// fails here before it can prove anything elsewhere.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateEventConfig, validateTheme, validateBadgesConfig, validateFeatures } = require('shared/config');
const { validateTicketCatalog } = require('shared/ticketCommerce');
const { validateSpeaker, EDITABLE_SPEAKER_FIELDS, SERVER_OWNED_SPEAKER_FIELDS, SPEAKER_STATUSES } = require('shared/speaker');
const { REGISTRATION_STATUSES } = require('shared/registration');
const { contentFieldsOf } = require('../cms/store.cjs');
const { validateSessionShape } = require('../schedule/sessions.cjs');
const { validateOrganizationFields } = require('../cms/organizations.cjs');
const { validatePageDoc } = require('../cms/pages.cjs');
const { validateUpdateDoc } = require('../cms/updates.cjs');
const { validateTimelineFields } = require('../cms/timeline.cjs');
const { buildNewUserDoc } = require('../users/lifecycle.cjs');
const { ticketsForFreeOrder } = require('../ticketing/stripeCommerce.cjs');
const { internals: { normalizeTicket } } = require('../ticketing/sync.cjs');
const { exportSeed } = require('./exportFixture.cjs');

const seed = exportSeed();
const docsOf = (collection) => Object.entries(seed)
  .filter(([path]) => path.split('/')[0] === collection)
  .map(([path, data]) => ({ id: path.split('/')[1], data }));
const sorted = (keys) => [...new Set(keys)].sort();

/** The keys store.publishDocs and store.writeDraft add to the content. */
const LIVE_KEYS = ['visible', 'revision', 'publishedAt', 'publishedBy', 'materialCount'];
const DRAFT_KEYS = ['visible', 'status', 'basedOnRevision', 'updatedAt', 'updatedBy'];

test('config documents pass the shared config validators', () => {
  assert.deepEqual(validateEventConfig(seed['config/event']).errors, []);
  assert.deepEqual(validateTheme(seed['config/theme']).errors, []);
  assert.deepEqual(validateBadgesConfig(seed['config/badges']).errors, []);
  assert.deepEqual(validateFeatures(seed['config/features']).errors, []);
  assert.deepEqual(Object.keys(seed['config/pitch_call']).sort(), ['closesAt', 'enabled', 'externalFormUrl']);
});

test('every CMS document carries only the publish bookkeeping store.cjs writes', () => {
  for (const collection of ['cmsSchedule', 'cmsOrganizations', 'cmsContent', 'cmsPages', 'cmsUpdates', 'cmsTimeline']) {
    for (const { id, data } of docsOf(collection)) {
      const extra = Object.keys(data).filter((key) => !(key in contentFieldsOf(data)) && !LIVE_KEYS.includes(key));
      assert.deepEqual(extra, [], `${collection}/${id}`);
      for (const key of ['visible', 'revision', 'publishedAt', 'publishedBy']) assert.ok(key in data, `${collection}/${id} ${key}`);
    }
    for (const { id, data } of docsOf(`${collection}_drafts`)) {
      const extra = Object.keys(data).filter((key) => !(key in contentFieldsOf(data)) && !DRAFT_KEYS.includes(key));
      assert.deepEqual(extra, [], `${collection}_drafts/${id}`);
      assert.ok(['dirty', 'clean'].includes(data.status), `${collection}_drafts/${id} status`);
      for (const key of DRAFT_KEYS) assert.ok(key in data, `${collection}_drafts/${id} ${key}`);
    }
  }
});

test('CMS content fields pass each editor\'s validator', () => {
  for (const collection of ['cmsSchedule', 'cmsSchedule_drafts']) {
    for (const { id, data } of docsOf(collection)) {
      assert.deepEqual(validateSessionShape(contentFieldsOf(data), id).errors, [], `${collection}/${id}`);
    }
  }
  for (const { id, data } of [...docsOf('cmsOrganizations'), ...docsOf('cmsOrganizations_drafts')]) {
    assert.equal(validateOrganizationFields(contentFieldsOf(data)).ok, true, id);
  }
  for (const { id, data } of docsOf('cmsPages')) {
    assert.deepEqual(validatePageDoc({ ...contentFieldsOf(data), visible: data.visible }).errors, [], id);
  }
  for (const { id, data } of docsOf('cmsUpdates')) assert.deepEqual(validateUpdateDoc(contentFieldsOf(data)).errors, [], id);
  for (const { id, data } of docsOf('cmsTimeline')) assert.equal(validateTimelineFields(contentFieldsOf(data)).ok, true, id);
});

test('speakers hold editable fields that validate, and server-owned fields only', () => {
  for (const { id, data } of docsOf('speakers')) {
    const unknown = Object.keys(data).filter((key) => !EDITABLE_SPEAKER_FIELDS.includes(key) && !SERVER_OWNED_SPEAKER_FIELDS.includes(key));
    assert.deepEqual(unknown, [], id);
    // The invite pipeline sets `invited` and `accepted`; an admin payload may not.
    assert.ok(SPEAKER_STATUSES.includes(data.status), id);
    const editable = Object.fromEntries(Object.entries(data).filter(([key]) => EDITABLE_SPEAKER_FIELDS.includes(key) && key !== 'status'));
    assert.deepEqual(validateSpeaker(editable).errors ?? [], [], id);
  }
});

test('users hold the fields buildNewUserDoc seeds, plus the organizer-owned ones', () => {
  const created = Object.keys(buildNewUserDoc({ uid: 'u', email: 'u@example.com' }, new Date()));
  for (const { id, data } of docsOf('users')) {
    assert.deepEqual(Object.keys(data).filter((key) => !created.includes(key) && !['pastAttendance', 'customBadges'].includes(key)), [], id);
    assert.ok(REGISTRATION_STATUSES.includes(data.registrationStatus), id);
    assert.equal(data.uid, id);
  }
});

test('the ticket catalog passes validateTicketCatalog', () => {
  const { revision: _r, updatedAt: _a, updatedBy: _b, ...catalog } = seed['ticket_catalog/current'];
  assert.deepEqual(validateTicketCatalog({ ...catalog, revision: 3 }).issues, []);
});

test('admissions carry the fields the Stripe and sync writers store, keyed by externalId', () => {
  const order = seed['ticket_orders/ord_fixture1'];
  const stripeKeys = sorted([...Object.keys(ticketsForFreeOrder(order)[0]), 'checkedInAt', 'checkedInByUid']);
  const syncedKeys = sorted([...Object.keys(normalizeTicket({ externalId: 'x' }, 'eventbrite')),
    'claimedByUid', 'claimedAt', 'claimPromptSentAt', 'createdAt', 'updatedAt']);
  for (const { id, data } of docsOf('tickets')) {
    assert.equal(data.externalId, id, 'a tickets document id is its externalId');
    const allowed = data.provider === 'stripe' ? stripeKeys : syncedKeys;
    assert.deepEqual(Object.keys(data).filter((key) => !allowed.includes(key)), [], id);
  }
  assert.deepEqual(order.ticketIds, order.seats.map((seat) => seat.externalId));
});

test('invoices hold the fields invoiceAdmin stores, and their drafts still validate', () => {
  const { validateInvoiceDraft, INVOICE_STATUSES, isInvoiceId } = require('shared/invoice');
  const invoices = docsOf('invoices');
  assert.equal(invoices.length, 2);
  for (const { id, data } of invoices) {
    assert.ok(isInvoiceId(id), id);
    assert.ok(INVOICE_STATUSES.includes(data.status), id);
    const verdict = validateInvoiceDraft({
      billTo: data.billTo, reference: data.reference, dueDate: data.dueDate, notes: data.notes,
      lines: data.lines.map(({ description, quantity, unitAmount }) => ({ description, quantity, unitAmount })),
      adjustments: data.adjustments,
    });
    assert.deepEqual(verdict.issues, [], id);
    assert.deepEqual(verdict.value.totals, data.totals, id);
  }
});
