'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSaveOwnSpeakerLogisticsHandler, createSubmitOwnSpeakerProfileHandler } = require('./profileSteps.cjs');
const { createGetOwnSpeakerProfileHandler } = require('./profile.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');

const NOW = () => Date.parse('2026-11-03T15:00:00Z');
const CONFIG = {
  event: { name: 'Example Summit', sender: { email: 's@example.org', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.org' } },
  theme: { colors: { primary: 'BRAND', ink: 'INK' } },
  tierA: { publicUrl: 'https://summit.example.org/' },
};
const auth = { async verifyIdToken(token) {
  return { uid: token, email: `${token}@example.org`, email_verified: true };
} };
function world(extra = {}) {
  return makeSpeakersDb({
    'config/bootstrap': { adminEmails: [], staffEmails: ['staff@example.org'] },
    'speakers/rae': { firstName: 'Rae', lastName: 'Okonkwo', slug: 'rae-okonkwo', email: 'rae@example.org', status: 'accepted', uid: 'u-rae' },
    'speakers/other': { firstName: 'Bo', lastName: 'Writer', slug: 'bo-writer', email: 'bo@example.org', status: 'accepted', uid: 'u-bo' },
    ...extra,
  });
}
async function call(create, db, token, body, sendResult = { status: 'sent' }) {
  const sent = [];
  const res = { statusCode: null, body: null, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await create({ db, auth, getConfig: async () => CONFIG, now: NOW, log: { error() {}, warn() {} },
    sendEmail: async (message) => { sent.push(message); return sendResult; } })({
    method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body,
  }, res);
  return { res, sent };
}

test('a speaker saves logistics to the private record, never onto the speaker', async () => {
  const db = world();
  const { res } = await call(createSaveOwnSpeakerLogisticsHandler, db, 'u-rae', { speakerId: 'rae', logistics: { travel: ' Train ', avNeeds: 'A clip-on mic.' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.logistics, { travel: 'Train', accessNeeds: null, avNeeds: 'A clip-on mic.' });
  const stored = db.read('speaker_logistics', 'rae');
  assert.equal(stored.travel, 'Train');
  assert.equal(stored.updatedBy, 'u-rae@example.org');
  assert.equal(Object.hasOwn(db.read('speakers', 'rae'), 'travel'), false);
  // The own read returns them, for the steps.
  const read = await call(createGetOwnSpeakerProfileHandler, db, 'u-rae', { speakerId: 'rae' });
  assert.equal(read.res.statusCode, 200);
  assert.equal(read.res.body.logistics.avNeeds, 'A clip-on mic.');
  assert.equal(read.res.body.speaker.profileSubmittedAt, null);
});

test('logistics refuses another speaker, a stranger and a bad answer without writing', async () => {
  const db = world();
  assert.equal((await call(createSaveOwnSpeakerLogisticsHandler, db, 'u-bo', { speakerId: 'rae', logistics: {} })).res.statusCode, 403);
  assert.equal((await call(createSaveOwnSpeakerLogisticsHandler, db, null, { speakerId: 'rae', logistics: {} })).res.statusCode, 401);
  const bad = await call(createSaveOwnSpeakerLogisticsHandler, db, 'u-rae', { speakerId: 'rae', logistics: { dietary: 'none' } });
  assert.equal(bad.res.statusCode, 400);
  assert.match(bad.res.body.error.message, /logistics\.dietary/);
  assert.equal(db.read('speaker_logistics', 'rae'), undefined);
  // Staff may save for a speaker.
  assert.equal((await call(createSaveOwnSpeakerLogisticsHandler, db, 'staff', { speakerId: 'rae', logistics: { travel: 'Car' } })).res.statusCode, 200);
});

test('submitting stamps the profile and sends speaker.profile_received once', async () => {
  const db = world();
  const first = await call(createSubmitOwnSpeakerProfileHandler, db, 'u-rae', { speakerId: 'rae' });
  assert.equal(first.res.statusCode, 200, JSON.stringify(first.res.body));
  assert.deepEqual(first.res.body, { speakerId: 'rae', submitted: true, emailed: true });
  assert.deepEqual(db.read('speakers', 'rae').profileSubmittedAt, new Date(NOW()));
  assert.equal(first.sent.length, 1);
  const [mail] = first.sent;
  assert.equal(mail.to, 'rae@example.org');
  assert.equal(mail.tag, 'speaker.profile_received');
  assert.equal(mail.onceKey, 'speaker-profile-received:rae');
  assert.match(mail.text, /https:\/\/summit\.example\.org\/speaker\/profile/);
  assert.doesNotMatch(`${mail.subject} ${mail.text}`, /confirmed/i, 'no claim about a time or room');
  const again = await call(createSubmitOwnSpeakerProfileHandler, db, 'u-rae', { speakerId: 'rae' });
  assert.deepEqual(again.res.body, { speakerId: 'rae', submitted: true, replayed: true, emailed: false });
  assert.equal(again.sent.length, 0);
});

test('a submit needs a name and the owner, and a failed email keeps the submit', async () => {
  const db = world({ 'speakers/nameless': { firstName: '', lastName: '', email: 'n@example.org', status: 'accepted', uid: 'u-n' } });
  const nameless = await call(createSubmitOwnSpeakerProfileHandler, db, 'u-n', { speakerId: 'nameless' });
  assert.equal(nameless.res.statusCode, 400);
  assert.equal(db.read('speakers', 'nameless').profileSubmittedAt, undefined);
  assert.equal((await call(createSubmitOwnSpeakerProfileHandler, db, 'u-bo', { speakerId: 'rae' })).res.statusCode, 403);
  const failed = await call(createSubmitOwnSpeakerProfileHandler, db, 'u-rae', { speakerId: 'rae' }, { status: 'failed' });
  assert.equal(failed.res.statusCode, 200);
  assert.equal(failed.res.body.emailed, false);
  assert.ok(db.read('speakers', 'rae').profileSubmittedAt);
});
