'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatSessionTime, buildConfirmationTokenValues, namedSlotOf, sameNamedSlot, sendSessionConfirmationEmail,
} = require('./confirmation.cjs');
const { resetTemplateCacheForTest } = require('../email/templates.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');

test.beforeEach(() => resetTemplateCacheForTest());

const CONFIG = {
  event: {
    name: 'Example Summit',
    days: [{ id: 'day-1', date: '2027-05-13' }],
    sender: { email: 's@example.org', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.org' },
  },
  theme: { colors: { primary: 'BRAND', ink: 'INK' } },
  tierA: { publicUrl: 'https://summit.example.org' },
};

const SPEAKER = { firstName: 'Rae', lastName: 'Okonkwo', email: 'rae@example.org' };
const SESSION = { title: 'Reporting on Deadline', dayId: 'day-1', startTime: '10:00 AM', endTime: '10:45 AM', location: 'Room B' };

test('formatSessionTime joins the configured day date with the clock range', () => {
  assert.equal(formatSessionTime(CONFIG.event, SESSION), '2027-05-13 · 10:00 AM–10:45 AM');
});

test('formatSessionTime falls back gracefully when the day or times are missing', () => {
  assert.equal(formatSessionTime(CONFIG.event, { dayId: 'nope', startTime: '', endTime: '' }), '');
  assert.equal(formatSessionTime(CONFIG.event, { dayId: 'day-1', startTime: '9 AM' }), '2027-05-13 · 9 AM');
});

test('buildConfirmationTokenValues assembles the four §6.2 per-template tokens', () => {
  const values = buildConfirmationTokenValues({ eventConfig: CONFIG.event, speaker: SPEAKER, session: SESSION });
  assert.deepEqual(values, {
    speaker_name: 'Rae Okonkwo',
    session_title: 'Reporting on Deadline',
    session_time: '2027-05-13 · 10:00 AM–10:45 AM',
    session_room: 'Room B',
  });
});

test('namedSlotOf and sameNamedSlot describe the slot a confirmation names', () => {
  const named = namedSlotOf(CONFIG.event, SESSION);
  assert.deepEqual(named, { title: 'Reporting on Deadline', time: '2027-05-13 · 10:00 AM–10:45 AM', room: 'Room B' });
  assert.equal(sameNamedSlot(named, { ...named }), true);
  assert.equal(sameNamedSlot(named, { ...named, room: 'Room C' }), false);
  assert.equal(sameNamedSlot(named, null), false);
});

test('sendSessionConfirmationEmail renders and sends with the attempt’s onceKey and returns the outcome', async () => {
  const db = makeSpeakersDb();
  const sent = [];
  const outcome = await sendSessionConfirmationEmail({
    db,
    sendEmail: async (message) => {
      sent.push(message);
      return { status: 'sent' };
    },
    getConfig: async () => CONFIG,
    onceKey: 'speaker-confirmation:rae:sess-1:1',
    speaker: SPEAKER,
    named: namedSlotOf(CONFIG.event, SESSION),
    log: { error() {}, warn() {} },
  });

  assert.equal(outcome.status, 'sent');
  assert.equal(sent.length, 1);
  const [message] = sent;
  assert.equal(message.to, 'rae@example.org');
  assert.equal(message.tag, 'speaker.confirmation');
  assert.equal(message.source, 'speaker-confirmation');
  assert.equal(message.onceKey, 'speaker-confirmation:rae:sess-1:1');
  assert.equal(message.storeRendered, true);
  assert.ok(message.html.includes('Reporting on Deadline'));
  assert.ok(message.text.includes('Room B'));
});

test('sendSessionConfirmationEmail never throws: a sender throw is a failed outcome, an ambiguous one passes through', async () => {
  const base = {
    db: makeSpeakersDb(),
    getConfig: async () => CONFIG,
    onceKey: 'speaker-confirmation:rae:sess-1:1',
    speaker: SPEAKER,
    named: namedSlotOf(CONFIG.event, SESSION),
    log: { error() {}, warn() {} },
  };
  const failed = await sendSessionConfirmationEmail({ ...base, sendEmail: async () => { throw new Error('provider unavailable'); } });
  assert.deepEqual(failed, { status: 'failed', error: 'provider unavailable' });
  const ambiguous = await sendSessionConfirmationEmail({ ...base, sendEmail: async () => ({ status: 'failed', ambiguous: true, error: 'socket hang up' }) });
  assert.equal(ambiguous.ambiguous, true);
  const noKey = await sendSessionConfirmationEmail({ ...base, onceKey: '', sendEmail: async () => ({ status: 'sent' }) });
  assert.equal(noKey.status, 'failed');
});
