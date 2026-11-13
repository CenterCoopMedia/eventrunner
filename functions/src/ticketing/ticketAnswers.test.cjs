'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSaveTicketAnswersHandler } = require('./ticketAnswers.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

const bootstrap = { adminEmails: ['operator@example.test'], staffEmails: ['staff@example.test'] };
const auth = { async verifyIdToken(token) {
  return { uid: token, email: `${token}@example.test`, email_verified: true };
} };
const FORM = {
  revision: 4,
  standard: { organization: { enabled: true, required: true }, dietary: { enabled: true }, directoryListing: { enabled: true } },
  custom: [{ id: 'q_shirt', kind: 'one_choice', label: 'T-shirt size', choices: ['S', 'M'], required: false }],
};
const OPEN_EVENT = { timezone: 'America/New_York', announcedAt: '2026-01-01T09:00', registration: { closesAt: '2027-05-01T17:00' }, days: [] };
const CLOSED_EVENT = { ...OPEN_EVENT, registration: { closesAt: '2026-10-01T17:00' } };
const NOW = Date.parse('2026-11-03T15:00:00Z');

function world(extra = {}) {
  return makeFakeDb({
    'config/bootstrap': bootstrap,
    'config/registration_form': FORM,
    'tickets/t-1': { externalId: 't-1', status: 'valid', claimedByUid: 'ada', email: 'ada@example.test' },
    'tickets/t-2': { externalId: 't-2', status: 'refunded', claimedByUid: 'ada' },
    'users/ada': { uid: 'ada', profileVisibility: 'attendees_only' },
    ...extra,
  });
}
async function save(db, token, body, { event = OPEN_EVENT, features = {}, providerName = 'manual' } = {}) {
  const res = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await createSaveTicketAnswersHandler({ db, auth, getConfig: async () => ({ bootstrap, event, features }), now: () => NOW, providerName, log: { error() {}, warn() {} } })({
    method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body,
  }, res);
  return res;
}
const ANSWERS = { organization: ' Example News ', dietary: { choices: ['Vegan'] }, directoryListing: 'private', q_shirt: 'M' };

test('the ticket holder saves checked answers privately, and the directory answer sets the profile', async () => {
  const db = world();
  const res = await save(db, 'ada', { ticketId: 't-1', formRevision: 4, answers: ANSWERS });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = db.read('ticket_answers', 't-1');
  assert.equal(stored.uid, 'ada');
  assert.equal(stored.formRevision, 4);
  assert.deepEqual(stored.answers, { organization: 'Example News', dietary: { choices: ['Vegan'], other: null }, directoryListing: 'private', q_shirt: 'M' });
  assert.equal(db.read('users', 'ada').profileVisibility, 'private');
});

test('a public directory answer needs the public profiles feature, as the profile page does', async () => {
  const db = world();
  await save(db, 'ada', { ticketId: 't-1', formRevision: 4, answers: { ...ANSWERS, directoryListing: 'public' } });
  assert.equal(db.read('users', 'ada').profileVisibility, 'attendees_only');
  await save(db, 'ada', { ticketId: 't-1', formRevision: 4, answers: { ...ANSWERS, directoryListing: 'public' } }, { features: { publicAttendeeProfiles: true } });
  assert.equal(db.read('users', 'ada').profileVisibility, 'public');
});

test('phone is normalized in private answers and never copied into account or public profile records', async () => {
  const originalUser = { uid: 'ada', profileVisibility: 'public', displayName: 'Ada' };
  const publicUser = { displayName: 'Ada', profileVisibility: 'public' };
  const db = world({
    'config/registration_form': { ...FORM, standard: { phone: { enabled: true, required: true } } },
    'users/ada': originalUser,
    'users_public/ada': publicUser,
  });
  const res = await save(db, 'ada', { ticketId: 't-1', formRevision: 4, answers: { phone: { entered: '(201) 555-0123', normalized: 'forged' } } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(db.read('ticket_answers', 't-1').answers.phone, { entered: '(201) 555-0123', normalized: '2015550123' });
  assert.deepEqual(db.read('users', 'ada'), originalUser);
  assert.deepEqual(db.read('users_public', 'ada'), publicUser);
  assert.equal((await save(db, 'bo', { ticketId: 't-1', formRevision: 4, answers: { phone: '2015550123' } })).statusCode, 403);
  const bad = await save(db, 'ada', { ticketId: 't-1', formRevision: 4, answers: { phone: 'call me' } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /answers\.phone: Enter a phone number/);
});

test('nobody else may answer for a ticket, and staff may', async () => {
  const db = world();
  assert.equal((await save(db, 'bo', { ticketId: 't-1', formRevision: 4, answers: ANSWERS })).statusCode, 403);
  assert.equal((await save(db, 'bo', { ticketId: 'missing', formRevision: 4, answers: ANSWERS })).statusCode, 403, 'a missing ticket answers like someone else\'s');
  assert.equal((await save(db, null, { ticketId: 't-1', formRevision: 4, answers: ANSWERS })).statusCode, 401);
  assert.equal(db.read('ticket_answers', 't-1'), undefined);
  assert.equal((await save(db, 'staff', { ticketId: 't-1', formRevision: 4, answers: ANSWERS })).statusCode, 200);
  assert.equal(db.read('ticket_answers', 't-1').updatedBy, 'staff@example.test');
});

test('answers are refused after registration closes, for a changed form, a bad answer or a ticket that is not valid', async () => {
  const db = world();
  const closed = await save(db, 'ada', { ticketId: 't-1', formRevision: 4, answers: ANSWERS }, { event: CLOSED_EVENT });
  assert.equal(closed.statusCode, 409);
  assert.equal(closed.body.error.code, 'registration-closed');
  assert.equal((await save(db, 'staff', { ticketId: 't-1', formRevision: 4, answers: ANSWERS }, { event: CLOSED_EVENT })).statusCode, 200, 'staff can still correct answers');
  const db2 = world();
  const stale = await save(db2, 'ada', { ticketId: 't-1', formRevision: 3, answers: ANSWERS });
  assert.equal(stale.body.error.code, 'form-changed');
  const bad = await save(db2, 'ada', { ticketId: 't-1', formRevision: 4, answers: { ...ANSWERS, organization: '', q_gone: 'x' } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /answers\.organization: Answer this question\./);
  assert.match(bad.body.error.message, /answers\.q_gone: This question is no longer asked\./);
  assert.equal((await save(db2, 'ada', { ticketId: 't-2', formRevision: 4, answers: ANSWERS })).body.error.code, 'ticket-not-valid');
  assert.equal(db2.read('ticket_answers', 't-1'), undefined);
});

const { syncAnswerStatus } = require('./ticketAnswers.cjs');

test('answers need a claimed ticket, so they always belong to an account', async () => {
  const db = world({ 'tickets/t-open': { externalId: 't-open', status: 'valid', claimedByUid: null } });
  const res = await save(db, 'staff', { ticketId: 't-open', formRevision: 4, answers: ANSWERS });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'ticket-unclaimed');
  assert.equal(db.read('ticket_answers', 't-open'), undefined);
});

test('each record keeps the questions as they were answered, and the ticket status', async () => {
  const db = world();
  await save(db, 'ada', { ticketId: 't-1', formRevision: 4, answers: ANSWERS });
  const stored = db.read('ticket_answers', 't-1');
  assert.equal(stored.ticketStatus, 'valid');
  assert.deepEqual(stored.questions.map((q) => [q.id, q.kind, q.name]), [
    ['organization', 'short_text', 'Organization'], ['dietary', 'dietary', 'Dietary needs'],
    ['directoryListing', 'directory', 'Attendee directory'], ['q_shirt', 'one_choice', 'T-shirt size'],
  ]);
  assert.deepEqual(stored.questions.find((q) => q.id === 'q_shirt').choices, ['S', 'M']);
});

test('a refund or cancellation marks the answers, and a ticket made valid again unmarks them', async () => {
  const db = world({ 'ticket_answers/t-1': { ticketId: 't-1', uid: 'ada', answers: {}, ticketStatus: 'valid' } });
  await db.collection('tickets').doc('t-1').update({ status: 'refunded' });
  await syncAnswerStatus({ db, ticketId: 't-1' });
  assert.equal(db.read('ticket_answers', 't-1').ticketStatus, 'refunded');
  await db.collection('tickets').doc('t-1').update({ status: 'valid' });
  await syncAnswerStatus({ db, ticketId: 't-1' });
  assert.equal(db.read('ticket_answers', 't-1').ticketStatus, 'valid');
  // No answers, no write; a deleted ticket reads as cancelled.
  const writes = db.writes.length;
  await syncAnswerStatus({ db, ticketId: 't-2' });
  assert.equal(db.writes.length, writes);
  await db.collection('tickets').doc('t-1').delete();
  await syncAnswerStatus({ db, ticketId: 't-1' });
  assert.equal(db.read('ticket_answers', 't-1').ticketStatus, 'cancelled');
});

// Events with no ticketing provider: the attendee answers for their account.
const NONE = { providerName: 'none' };

test('with no ticketing provider, the attendee answers for their account', async () => {
  const db = world();
  const res = await save(db, 'ada', { account: true, formRevision: 4, answers: ANSWERS }, NONE);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = db.read('ticket_answers', 'account-ada');
  assert.equal(stored.ticketId, null);
  assert.equal(stored.account, true);
  assert.equal(stored.uid, 'ada');
  assert.equal(stored.ticketStatus, 'valid');
  assert.equal(stored.answers.organization, 'Example News');
  assert.equal(stored.questions.length, 4);
  assert.equal(db.read('users', 'ada').profileVisibility, 'private');
});

test('account answers are refused when the event sells tickets, or combined with a ticket', async () => {
  const db = world();
  const manual = await save(db, 'ada', { account: true, formRevision: 4, answers: ANSWERS });
  assert.equal(manual.statusCode, 409);
  assert.equal(manual.body.error.code, 'account-answers-unavailable');
  const both = await save(db, 'staff', { account: true, ticketId: 't-1', formRevision: 4, answers: ANSWERS }, NONE);
  assert.equal(both.statusCode, 400);
  assert.equal(db.read('ticket_answers', 'account-ada'), undefined);
});

test('account answers follow the same closing date and form revision as ticket answers', async () => {
  const db = world();
  const closed = await save(db, 'ada', { account: true, formRevision: 4, answers: ANSWERS }, { ...NONE, event: CLOSED_EVENT });
  assert.equal(closed.statusCode, 409);
  assert.equal(closed.body.error.code, 'registration-closed');
  const stale = await save(db, 'ada', { account: true, formRevision: 3, answers: ANSWERS }, NONE);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error.code, 'form-changed');
  assert.equal(db.read('ticket_answers', 'account-ada'), undefined);
});

test('syncAnswerStatus leaves account answers alone: no ticket stands behind them', async () => {
  const db = world({ 'ticket_answers/account-ada': { ticketId: null, account: true, uid: 'ada', answers: {}, ticketStatus: 'valid' } });
  const writes = db.writes.length;
  assert.deepEqual(await syncAnswerStatus({ db, ticketId: 'account-ada' }), { changed: false });
  assert.equal(db.writes.length, writes);
  assert.equal(db.read('ticket_answers', 'account-ada').ticketStatus, 'valid');
});

test('a staff member at an event with no tickets answers for their own account, under the same closing date', async () => {
  const db = world({ 'users/staff': { uid: 'staff', profileVisibility: 'attendees_only' } });
  const own = await save(db, 'staff', { account: true, formRevision: 4, answers: ANSWERS }, NONE);
  assert.equal(own.statusCode, 200, JSON.stringify(own.body));
  assert.equal(db.read('ticket_answers', 'account-staff').uid, 'staff');
  assert.equal(db.writes.filter((write) => write.path.startsWith('admin_logs/')).length, 0, 'answering for oneself is not an admin action');
  const closed = await save(db, 'staff', { account: true, formRevision: 4, answers: ANSWERS }, { ...NONE, event: CLOSED_EVENT });
  assert.equal(closed.body.error.code, 'registration-closed');
});

test('a real ticket whose id starts with "account-" still follows its refunds; only account records are skipped', async () => {
  const db = world({
    'tickets/account-123': { externalId: 'account-123', status: 'refunded', claimedByUid: 'ada' },
    'ticket_answers/account-123': { ticketId: 'account-123', uid: 'ada', answers: {}, ticketStatus: 'valid' },
    'ticket_answers/account-ada': { ticketId: null, account: true, uid: 'ada', answers: {}, ticketStatus: 'valid' },
  });
  assert.deepEqual(await syncAnswerStatus({ db, ticketId: 'account-123' }), { changed: true });
  assert.equal(db.read('ticket_answers', 'account-123').ticketStatus, 'refunded');
  assert.deepEqual(await syncAnswerStatus({ db, ticketId: 'account-ada' }), { changed: false });
  assert.equal(db.read('ticket_answers', 'account-ada').ticketStatus, 'valid');
});
