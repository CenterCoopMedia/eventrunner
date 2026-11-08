'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readImport, createQueueHandler } = require('./pitchQueue.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const row = { externalId: '17', email: 'speaker@example.test', title: 'Local reporting', description: 'A practical session.', consent: true };
test('external-form import requires real consent and stable unique source identities', () => {
  const parsed = readImport({ source: 'external-form', rows: [row] });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].externalId, '17');
  assert.equal(parsed.rows[0].id, readImport({ source: 'external-form', rows: [row] }).rows[0].id);
  assert.notEqual(parsed.rows[0].id, readImport({ source: 'other-form', rows: [row] }).rows[0].id);
  assert.match(readImport({ source: 'external-form', rows: [{ ...row, consent: false }] }).error, /consent/);
  assert.match(readImport({ source: 'external-form', rows: [null] }).error, /externalId/);
  assert.match(readImport({ source: 'external-form', rows: [row, row] }).error, /unique externalId/);
  assert.match(readImport({ source: 'external-form', rows: [row, { ...row, externalId: '18', title: '' }] }).error, /title/);
});

test('an import row carries the pitch stepper fields it has, and a legacy row stays as it was', () => {
  const legacy = readImport({ source: 'external-form', rows: [row] }).rows[0];
  assert.deepEqual(Object.keys(legacy).sort(), ['description', 'email', 'externalId', 'format', 'id', 'organization', 'source', 'title']);
  const full = readImport({ source: 'external-form', rows: [{
    ...row, summary: 'One line.', lengthMinutes: '60', track: 'Audience', audienceLevel: 'beginner', leadName: 'Ada',
    presenter_1_name: 'Bo', presenter_1_email: 'bo@example.test',
  }] }).rows[0];
  assert.equal(full.lengthMinutes, 60);
  assert.equal(full.audienceLevel, 'beginner');
  assert.deepEqual(full.presenters.map((p) => [p.name, p.email, p.lead]), [['Ada', 'speaker@example.test', true], ['Bo', 'bo@example.test', false]]);
  assert.match(readImport({ source: 'external-form', rows: [{ ...row, lengthMinutes: 'long' }] }).error, /Row 1: lengthMinutes/);
});

test('re-importing the same row with presenters is unchanged, and a changed presenter conflicts', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap });
  const handler = createQueueHandler({ db, auth, getConfig: async () => ({ bootstrap }), now: () => 1000, log: { error() {} } }, 'import');
  const body = { source: 'external-form', rows: [{ ...row, leadName: 'Ada', presenter_1_name: 'Bo', presenter_1_email: 'bo@example.test' }] };
  const send = async (payload) => {
    const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, set() { return this; } };
    await handler({ method: 'POST', headers: { authorization: 'Bearer staff' }, body: payload }, res);
    return res;
  };
  assert.deepEqual((await send(body)).body, { imported: 1, unchanged: 0 });
  assert.deepEqual((await send(body)).body, { imported: 0, unchanged: 1 });
  const changed = { ...body, rows: [{ ...body.rows[0], presenter_1_name: 'Someone else' }] };
  assert.equal((await send(changed)).statusCode, 409);
});

const bootstrap = { adminEmails: ['operator@example.test'], staffEmails: ['staff@example.test'] };
const auth = { async verifyIdToken(token) {
  return { uid: token, email: `${token}@example.test`, email_verified: token !== 'unverified' };
} };
function queueDb(pitch = { ...row, status: 'accepted', reviewRevision: 1 }) {
  return makeFakeDb({
    'config/bootstrap': bootstrap,
    'config/event': { days: [{ id: 'day-one' }] },
    'session_pitches/proposal': pitch,
  });
}
const conversion = { id: 'proposal', expectedRevision: 1, firstName: 'Example', lastName: 'Presenter', dayId: 'day-one', startTime: '10:00', endTime: '11:00' };
async function invoke(db, action, token, body, method = 'POST') {
  const res = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await createQueueHandler({ db, auth, now: () => 1_800_000_000_000, log: { error() {} } }, action)({
    method, headers: token ? { authorization: `Bearer ${token}` } : {}, body,
  }, res);
  return res;
}

test('both private queue actions admit staff and operators and refuse other identities', async () => {
  for (const action of ['import', 'convert']) {
    const body = action === 'import' ? { source: 'external-form', rows: [row] } : conversion;
    for (const token of ['staff', 'operator']) {
      const db = queueDb();
      assert.equal((await invoke(db, action, token, body)).statusCode, 200);
      if (action === 'convert') {
        assert.equal(db.read('cmsSchedule_drafts', 'pitch-proposal').visible, false);
        assert.equal(db.read('speakers', 'pitch-proposal').status, 'draft');
        assert.equal(db.read('cmsSchedule', 'pitch-proposal'), undefined);
      }
    }
    for (const [token, status] of [[null, 401], ['visitor', 403], ['unverified', 403]]) {
      const db = queueDb();
      assert.equal((await invoke(db, action, token, body)).statusCode, status);
      assert.equal(db.writes.length, 0);
    }
    const revoked = queueDb();
    await revoked.collection('config').doc('bootstrap').set({ adminEmails: [], staffEmails: [] });
    assert.equal((await invoke(revoked, action, 'staff', body)).statusCode, 403);
  }
});

test('conversion checks the accepted revision and replays its frozen result without new writes', async () => {
  const db = queueDb({ ...row, format: 'Workshop', status: 'accepted', reviewRevision: 1 });
  assert.equal((await invoke(db, 'convert', 'staff', { ...conversion, id: 'missing' })).statusCode, 404);
  assert.equal((await invoke(db, 'convert', 'staff', { ...conversion, expectedRevision: 0 })).statusCode, 409);
  await db.collection('session_pitches').doc('proposal').update({ status: 'new' });
  assert.equal((await invoke(db, 'convert', 'staff', conversion)).statusCode, 409);
  await db.collection('session_pitches').doc('proposal').update({ status: 'accepted' });
  const result = await invoke(db, 'convert', 'staff', conversion);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.revision, 2);
  const draft = db.read('cmsSchedule_drafts', 'pitch-proposal');
  assert.equal(draft.type, 'Workshop');
  assert.equal(Object.hasOwn(draft, 'format'), false);
  await db.collection('session_pitches').doc('proposal').update({ reviewRevision: 3 });
  const writes = db.writes.length;
  assert.deepEqual((await invoke(db, 'convert', 'staff', conversion)).body, { ...result.body, replayed: true });
  assert.equal(db.writes.length, writes);
});

test('queue size and method gates refuse requests before proposal writes', async () => {
  for (const action of ['import', 'convert']) {
    const db = queueDb();
    assert.equal((await invoke(db, action, 'staff', { padding: 'x'.repeat(512 * 1024) })).statusCode, 413);
    assert.equal((await invoke(db, action, 'staff', {}, 'GET')).statusCode, 405);
    assert.equal(db.writes.length, 0);
  }
});

test('an unchanged re-import stays unchanged after Firestore returns the presenter keys in another order', async () => {
  const db = makeFakeDb({ 'config/bootstrap': bootstrap });
  const handler = createQueueHandler({ db, auth, getConfig: async () => ({ bootstrap }), now: () => 1000, log: { error() {} } }, 'import');
  const body = { source: 'external-form', rows: [{ ...row, leadName: 'Ada', presenter_1_name: 'Bo', presenter_1_email: 'bo@example.test' }] };
  const send = async (payload) => {
    const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, set() { return this; } };
    await handler({ method: 'POST', headers: { authorization: 'Bearer staff' }, body: payload }, res);
    return res;
  };
  assert.deepEqual((await send(body)).body, { imported: 1, unchanged: 0 });
  const [id] = db.ids('session_pitches');
  const stored = db.read('session_pitches', id);
  const reordered = stored.presenters.map((p) => Object.fromEntries(Object.keys(p).sort().map((k) => [k, p[k]])));
  await db.collection('session_pitches').doc(id).update({ presenters: reordered });
  assert.deepEqual((await send(body)).body, { imported: 0, unchanged: 1 });
});

// ADR 0008 §3: one speaker per presenter, linked by email, invited at once.
const CONFIG = {
  event: { name: 'Example Summit', days: [{ id: 'day-one', date: '2027-05-13' }], sender: { email: 's@example.org', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.org' } },
  theme: { colors: { primary: 'BRAND', ink: 'INK' } },
  tierA: { publicUrl: 'https://summit.example.org' },
  bootstrap,
};
const presenters = [
  { name: 'Ada Reporter', email: 'speaker@example.test', organization: 'Example News', role: 'Editor', lead: true },
  { name: 'Bo Writer', email: 'bo@example.test', organization: null, role: null, lead: false },
  { name: 'Cy Known', email: 'cy@example.test', organization: null, role: null, lead: false },
];
const team = { ...conversion, speakers: [
  { firstName: 'Ada', lastName: 'Reporter' }, { firstName: 'Bo', lastName: 'Writer' }, null,
] };
function teamDb(extra = {}) {
  return makeFakeDb({
    'config/bootstrap': bootstrap,
    'config/event': { days: [{ id: 'day-one' }] },
    'session_pitches/proposal': { ...row, presenters, status: 'accepted', reviewRevision: 1 },
    'speakers/cy-known': { firstName: 'Cy', lastName: 'Known', slug: 'cy-known', email: 'cy@example.test', status: 'approved' },
    ...extra,
  });
}
async function convertWith(db, body, { sendResult = { status: 'sent', providerMessageId: 'm1' } } = {}) {
  const sent = [];
  const res = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await createQueueHandler({
    db, auth, getConfig: async () => CONFIG, now: () => 1_800_000_000_000, log: { error() {}, warn() {} },
    sendEmail: async (message) => { sent.push(message); return sendResult; },
  }, 'convert')({ method: 'POST', headers: { authorization: 'Bearer staff' }, body }, res);
  return { res, sent };
}

test('conversion makes one speaker per new presenter and links a presenter who is already a speaker', async () => {
  const db = teamDb();
  const { res, sent } = await convertWith(db, team);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.speakerIds, ['pitch-proposal', 'pitch-proposal-2', 'cy-known']);
  assert.deepEqual(res.body.createdSpeakerIds, ['pitch-proposal', 'pitch-proposal-2']);
  assert.equal(res.body.speakerId, 'pitch-proposal', 'the lead stays first, for old readers');
  assert.deepEqual(db.read('cmsSchedule_drafts', 'pitch-proposal').speakerIds, ['pitch-proposal', 'pitch-proposal-2', 'cy-known']);
  const lead = db.read('speakers', 'pitch-proposal');
  assert.deepEqual([lead.firstName, lead.lastName, lead.email, lead.organization, lead.jobTitle, lead.status], ['Ada', 'Reporter', 'speaker@example.test', 'Example News', 'Editor', 'draft']);
  assert.equal(db.read('speakers', 'pitch-proposal-2').email, 'bo@example.test');
  assert.equal(db.read('speakers', 'cy-known').status, 'approved', 'a linked speaker is not changed');
  assert.equal(db.read('speakers', 'cy-known').firstName, 'Cy', 'a linked speaker needs no name');
  assert.deepEqual(res.body.invites, []);
  assert.equal(sent.length, 0, 'no invite without the box');
});

test('the invite box sends the speaker invite to each new speaker in the same action', async () => {
  const db = teamDb();
  const { res, sent } = await convertWith(db, { ...team, invite: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.invites, [
    { speakerId: 'pitch-proposal', email: 'speaker@example.test', sent: true },
    { speakerId: 'pitch-proposal-2', email: 'bo@example.test', sent: true },
  ]);
  assert.deepEqual(sent.map((m) => [m.to, m.tag]), [['speaker@example.test', 'speaker.invite'], ['bo@example.test', 'speaker.invite']]);
  assert.equal(db.read('speakers', 'pitch-proposal').status, 'invited');
  assert.equal(db.read('speakers', 'cy-known').status, 'approved');
  // A retry replays the conversion and sends nothing again.
  const again = await convertWith(db, { ...team, invite: true });
  assert.equal(again.res.body.replayed, true);
  assert.equal(again.sent.length, 0);
});

test('a failed invite keeps the drafts and says which presenter was not invited', async () => {
  const db = teamDb();
  const { res } = await convertWith(db, { ...team, invite: true }, { sendResult: { status: 'failed' } });
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('speakers', 'pitch-proposal').status, 'invited', 'the invitation is recorded; Resend mints a new one');
  assert.deepEqual(res.body.invites.map((i) => [i.speakerId, i.sent]), [['pitch-proposal', false], ['pitch-proposal-2', false]]);
  assert.match(res.body.invites[0].message, /could not be emailed/);
});

test('conversion refuses names that do not match the presenters, and a one-speaker body still works', async () => {
  const db = teamDb();
  const short = await convertWith(db, { ...team, speakers: team.speakers.slice(0, 2) });
  assert.equal(short.res.statusCode, 409);
  assert.equal(short.res.body.error.code, 'presenters-changed');
  const blank = await convertWith(db, { ...team, speakers: [team.speakers[0], null, null] });
  assert.equal(blank.res.statusCode, 400);
  assert.match(blank.res.body.error.message, /speakers\.1/);
  assert.equal(db.read('speakers', 'pitch-proposal'), undefined);
  const solo = queueDb();
  const legacy = await convertWith(solo, conversion);
  assert.equal(legacy.res.statusCode, 200);
  assert.deepEqual(legacy.res.body.speakerIds, ['pitch-proposal']);
});

test('a name confirmed for one presenter is never used for another', async () => {
  const db = teamDb();
  // Staff replaced Bo with Dee after the dialog was filled in: same count.
  await db.collection('session_pitches').doc('proposal').update({ presenters: [presenters[0], { ...presenters[1], name: 'Dee New', email: 'dee@example.test' }, presenters[2]] });
  const stale = await convertWith(db, { ...team, invite: true, speakers: [
    { email: 'speaker@example.test', firstName: 'Ada', lastName: 'Reporter' },
    { email: 'bo@example.test', firstName: 'Bo', lastName: 'Writer' },
    { email: 'cy@example.test' },
  ] });
  assert.equal(stale.res.statusCode, 409);
  assert.equal(stale.res.body.error.code, 'presenters-changed');
  assert.equal(stale.sent.length, 0);
  assert.equal(db.read('speakers', 'pitch-proposal-2'), undefined);
  const fresh = await convertWith(db, { ...team, speakers: [
    { email: 'speaker@example.test', firstName: 'Ada', lastName: 'Reporter' },
    { email: 'DEE@example.test', firstName: 'Dee', lastName: 'New' },
    { email: 'cy@example.test' },
  ] });
  assert.equal(fresh.res.statusCode, 200, JSON.stringify(fresh.res.body));
  assert.equal(db.read('speakers', 'pitch-proposal-2').firstName, 'Dee');
});

test('a converted pitch cannot move off accepted, but its notes can still change', async () => {
  const { createReviewSessionPitchHandler } = require('./pitches.cjs');
  const converted = {
    ...row, status: 'accepted', reviewRevision: 2,
    conversion: { sessionId: 'session-1', speakerIds: ['speaker-1'] }, convertedAt: new Date(500),
  };
  const db = makeFakeDb({ 'config/bootstrap': bootstrap, 'session_pitches/proposal': converted });
  const handler = createReviewSessionPitchHandler({ db, auth, getConfig: async () => ({ bootstrap }), now: () => 1000, log: { error() {} } });
  const send = async (body) => {
    const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, set() { return this; } };
    await handler({ method: 'POST', headers: { authorization: 'Bearer staff' }, body }, res);
    return res;
  };
  for (const status of ['declined', 'in_review', 'new']) {
    const refused = await send({ id: 'proposal', status, expectedStatus: 'accepted', expectedRevision: 2 });
    assert.equal(refused.statusCode, 409, status);
    assert.equal(refused.body.error.code, 'pitch-converted');
  }
  assert.equal(db.read('session_pitches', 'proposal').status, 'accepted');
  const notes = await send({ id: 'proposal', status: 'accepted', expectedStatus: 'accepted', expectedRevision: 2, privateNotes: 'Booked.' });
  assert.equal(notes.statusCode, 200);
  assert.equal(db.read('session_pitches', 'proposal').privateNotes, 'Booked.');
});
