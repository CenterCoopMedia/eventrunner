'use strict';

// The Registrations import type (ADR 0008 §7): manual tickets with the
// registration answers held until each attendee claims.
const test = require('node:test');
const assert = require('node:assert/strict');

const { claimTicket } = require('../ticketing/registration.cjs');
const { makeDb, previewAndCommit, callImport, writtenCollections } = require('./importTestKit.cjs');

const FORM = {
  standard: { organization: { enabled: true, required: true }, photoConsent: { enabled: true, required: true } },
  custom: [{ id: 'q_meal', kind: 'one_choice', label: 'Lunch', choices: ['Fish', 'Vegetable'], required: false }],
  revision: 3,
};
const MAPPING = {
  externalId: 'Ticket', email: 'Email', firstName: 'First', lastName: 'Last', ticketClass: 'Type',
  'answer:organization': 'Newsroom', 'answer:q_meal': 'Lunch',
};
const ROW = { Ticket: 'REG-1', Email: 'Ada@Example.org', First: 'Ada', Last: 'Lovelace', Type: 'Full pass', Newsroom: 'Gazette', Lunch: 'fish' };
const body = (rows = [ROW], mapping = MAPPING) => ({ type: 'registrations', mapping, rows });

function withProvider(name, fn) {
  return async () => {
    const before = process.env.EVENT_TICKETING_PROVIDER;
    process.env.EVENT_TICKETING_PROVIDER = name;
    try { await fn(); } finally {
      if (before === undefined) delete process.env.EVENT_TICKETING_PROVIDER;
      else process.env.EVENT_TICKETING_PROVIDER = before;
    }
  };
}
const dbWithForm = (seed = {}) => makeDb({ 'config/registration_form': FORM, ...seed });

test('a new row makes a valid manual ticket and holds its answers, unclaimed', withProvider('manual', async () => {
  const db = dbWithForm();
  const dry = await callImport(db, { ...body(), dryRun: true });
  assert.equal(dry.statusCode, 200, JSON.stringify(dry.body));
  assert.deepEqual(dry.body.summary, { create: 1, update: 0, unchanged: 0, error: 0 });
  assert.equal(db.ids('tickets').length, 0, 'a preview writes nothing');
  const { commit } = await previewAndCommit(db, body());
  assert.equal(commit.statusCode, 200);
  const ticket = db.read('tickets', 'REG-1');
  assert.equal(ticket.provider, 'manual');
  assert.equal(ticket.status, 'valid');
  assert.equal(ticket.email, 'ada@example.org');
  assert.equal(ticket.ticketClass, 'Full pass');
  assert.equal(ticket.claimedByUid, null);
  const hold = db.read('ticket_answer_holds', 'REG-1');
  assert.deepEqual(hold.answers, { organization: 'Gazette', q_meal: 'Fish' });
  assert.equal(hold.formRevision, 3);
  assert.deepEqual(hold.questions.map((question) => question.id), ['organization', 'q_meal']);
  // A required question the file leaves out is not an error: the attendee answers it later.
  assert.equal(db.ids('ticket_answers').length, 0, 'answers belong to an account, so none before a claim');
}));

test('the claim moves held answers to the account and removes the hold', withProvider('manual', async () => {
  const db = dbWithForm();
  await previewAndCommit(db, body());
  const result = await claimTicket({ db, externalId: 'REG-1', uid: 'uid-ada', email: 'ada@example.org' });
  assert.equal(result.claimed, true);
  const record = db.read('ticket_answers', 'REG-1');
  assert.equal(record.uid, 'uid-ada');
  assert.deepEqual(record.answers, { organization: 'Gazette', q_meal: 'Fish' });
  assert.equal(record.updatedBy, 'import');
  assert.equal(db.read('ticket_answer_holds', 'REG-1'), undefined);
}));

test('an answer the attendee saved before the claim wins over the held one', withProvider('manual', async () => {
  const db = dbWithForm();
  await previewAndCommit(db, body());
  await db.collection('ticket_answers').doc('REG-1').set({ ticketId: 'REG-1', uid: 'uid-ada', answers: { organization: 'Own words' } });
  await claimTicket({ db, externalId: 'REG-1', uid: 'uid-ada', email: 'ada@example.org' });
  assert.deepEqual(db.read('ticket_answers', 'REG-1').answers, { organization: 'Own words' });
  assert.equal(db.read('ticket_answer_holds', 'REG-1'), undefined);
}));

test('a re-import changes nothing; a new file value lands unless the attendee changed it', withProvider('manual', async () => {
  const db = dbWithForm();
  await previewAndCommit(db, body());
  const again = await previewAndCommit(db, body());
  assert.deepEqual(again.commit.body.summary, { create: 0, update: 0, unchanged: 1, error: 0 });

  await claimTicket({ db, externalId: 'REG-1', uid: 'uid-ada', email: 'ada@example.org' });
  // The attendee changed their newsroom; the file changes lunch.
  await db.collection('ticket_answers').doc('REG-1').set({ answers: { organization: 'Courier', q_meal: 'Fish' } }, { merge: true });
  const changed = await previewAndCommit(db, body([{ ...ROW, Newsroom: 'Herald', Lunch: 'Vegetable' }]));
  const row = changed.commit.body.rows[0];
  assert.equal(row.verdict, 'update');
  assert.ok(row.notes.some((note) => /answer:organization/.test(note)), JSON.stringify(row.notes));
  assert.deepEqual(db.read('ticket_answers', 'REG-1').answers, { organization: 'Courier', q_meal: 'Vegetable' });
  assert.equal(db.read('ticket_answers', 'REG-1').uid, 'uid-ada');
}));

test('the email of a claimed ticket never changes by import', withProvider('manual', async () => {
  const db = dbWithForm();
  await previewAndCommit(db, body());
  await claimTicket({ db, externalId: 'REG-1', uid: 'uid-ada', email: 'ada@example.org' });
  const moved = await previewAndCommit(db, body([{ ...ROW, Email: 'someone@example.org' }]));
  assert.equal(moved.commit.body.rows[0].verdict, 'error');
  assert.match(moved.commit.body.rows[0].reasons.join(' '), /claimed/);
  assert.equal(db.read('tickets', 'REG-1').email, 'ada@example.org');
}));

test('bad cells, unknown questions and bad ids are row errors that name the field', withProvider('manual', async () => {
  const db = dbWithForm();
  const res = await callImport(db, { ...body([
    { ...ROW, Lunch: 'Soup' },
    { ...ROW, Ticket: 'REG-2', Email: 'not-an-email' },
    { ...ROW, Ticket: 'bad/id' },
  ]), dryRun: true });
  const reasons = res.body.rows.map((row) => row.reasons.join(' '));
  assert.match(reasons[0], /answer:q_meal/);
  assert.match(reasons[1], /email/);
  assert.match(reasons[2], /externalId/);
  const unknown = await callImport(db, { ...body([ROW], { ...MAPPING, 'answer:q_gone': 'Lunch' }), dryRun: true });
  assert.equal(unknown.statusCode, 200);
  assert.match(unknown.body.rows[0].reasons.join(' '), /answer:q_gone: the registration form does not ask this question/);
}));

test('another ticketing provider refuses every row and writes nothing', withProvider('stripe', async () => {
  const db = dbWithForm();
  const before = db.writes.length;
  const { preview, commit } = await previewAndCommit(db, body());
  assert.equal(preview.body.rows[0].verdict, 'error');
  assert.match(preview.body.rows[0].reasons[0], /manual/);
  assert.equal(commit.body.summary.error, 1);
  assert.deepEqual(writtenCollections(db, before).filter((name) => name !== 'admin_logs'), []);
}));

test('a new email on an unclaimed ticket drops the old answers: a new email is a new person', withProvider('manual', async () => {
  const db = dbWithForm();
  await previewAndCommit(db, body());
  // Only the ticket ID and email are mapped: the old answers must not pass to the new address.
  const moved = await previewAndCommit(db, body([{ Ticket: 'REG-1', Email: 'carl@example.org' }], { externalId: 'Ticket', email: 'Email' }));
  assert.equal(moved.commit.body.rows[0].verdict, 'update');
  assert.equal(db.read('tickets', 'REG-1').email, 'carl@example.org');
  assert.equal(db.read('ticket_answer_holds', 'REG-1'), undefined);
  await claimTicket({ db, externalId: 'REG-1', uid: 'uid-carl', email: 'carl@example.org' });
  assert.equal(db.read('ticket_answers', 'REG-1'), undefined);

  // With answers on the same row, the hold holds only those.
  await previewAndCommit(db, body([{ ...ROW, Ticket: 'REG-2' }]));
  await previewAndCommit(db, body([{ ...ROW, Ticket: 'REG-2', Email: 'dee@example.org', Newsroom: '', Lunch: 'Vegetable' }]));
  assert.deepEqual(db.read('ticket_answer_holds', 'REG-2').answers, { q_meal: 'Vegetable' });
}));

test('the directory question cannot be imported: the attendee chooses their listing', withProvider('manual', async () => {
  const db = makeDb({ 'config/registration_form': { ...FORM, standard: { ...FORM.standard, directoryListing: { enabled: true } } } });
  const res = await callImport(db, { ...body([{ ...ROW, Listing: 'public' }], { ...MAPPING, 'answer:directoryListing': 'Listing' }), dryRun: true });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /answer:directoryListing/);
}));

test('an imported ticket carries its ID as the order reference, so the claim page finds it', withProvider('manual', async () => {
  const db = dbWithForm();
  await previewAndCommit(db, body());
  assert.equal(db.read('tickets', 'REG-1').orderId, 'REG-1');
}));

test('an update keeps the saved question for answers the import did not change', withProvider('manual', async () => {
  const db = dbWithForm();
  await previewAndCommit(db, body());
  // The lunch question changes kind after the answer was held.
  await db.collection('config').doc('registration_form').set({
    ...FORM, revision: 4, custom: [{ id: 'q_meal', kind: 'short_text', label: 'Lunch notes' }],
  });
  const updated = await previewAndCommit(db, body([{ ...ROW, Newsroom: 'Herald' }], { externalId: 'Ticket', email: 'Email', 'answer:organization': 'Newsroom' }));
  assert.equal(updated.commit.body.rows[0].verdict, 'update');
  const hold = db.read('ticket_answer_holds', 'REG-1');
  assert.deepEqual(hold.answers, { organization: 'Herald', q_meal: 'Fish' });
  assert.equal(hold.questions.find((question) => question.id === 'q_meal').kind, 'one_choice');
}));
