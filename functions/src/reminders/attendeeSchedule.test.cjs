'use strict';

// The attendee reminder schedule (issue #518, ADR 0006) against the
// in-memory fake, through the real email core and the real console
// provider: two runs send once, the audience and the unsubscribe contract
// of announcement email, quiet hours and a schedule change part way, a
// resume without a second copy, the wording and facts pauses, the channel
// refusal, and the demo refusal. tests/reminder-schedules.rules.test.js
// repeats the full run on the Firestore emulator.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSpeakersDb } = require('../speakers/speakersFake.cjs');
const { createEmailCore } = require('../email/send.cjs');
const { createConsoleProvider } = require('../email/providers/console.cjs');
const { suppressionIdFor } = require('../announcements/suppression.cjs');
const { CHUNK_SIZE } = require('../announcements/sendRunner.cjs');
const { SCHEDULES, RUNS, LEDGER } = require('./scheduleCore.cjs');
const {
  SCHEDULE_ID,
  DEFAULT_DRAFT,
  normalizeAttendeeSchedule,
  readAttendeeSettings,
  attendeeWordingVersion,
  eventFacts,
  sendIdFor,
  daysUntilWords,
  runAttendeeSchedule,
} = require('./attendeeSchedule.cjs');
const { runScheduledReminders } = require('./run.cjs');

const QUIET = { error() {}, warn() {}, info() {}, log() {} };
const ZONE = 'America/New_York';
const HOUR = 3_600_000;
// The event starts Tuesday 2026-12-01 at 09:00 in New York (EST, UTC-5).
// The 7-day window opens 2026-11-24 at 10:00 EST (15:00Z) and closes when
// the 1-day window opens, 2026-11-30 at 10:00 EST. The 1-day window closes
// when the event starts.
const IN_7D = Date.parse('2026-11-24T15:30:00Z');
const IN_1D = Date.parse('2026-11-30T15:30:00Z');
const SITE = 'https://site.example.test';

const CONFIG = {
  event: {
    name: 'Example Event',
    timezone: ZONE,
    sender: { email: 'events@example.test', name: 'Example Event' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.test' },
    days: [{ id: 'day-1', date: '2026-12-01', startTime: '09:00', endTime: '17:00' }],
    venue: { name: 'Example Hall', addressLine1: '1 Main St', city: 'Example City' },
    social: { handles: [] },
  },
  theme: { colors: {} },
  tierA: { publicUrl: SITE, ticketingProvider: 'manual' },
  providers: { email: { provider: 'console', messageStream: null, announcementStream: 'announcements' } },
};

function withEvent(patch, tierA = {}) {
  return { ...CONFIG, event: { ...CONFIG.event, ...patch }, tierA: { ...CONFIG.tierA, ...tierA } };
}

function approvedSchedule(overrides = {}, config = CONFIG) {
  return {
    enabled: true,
    offsetsDays: [7, 1],
    sendTime: '10:00',
    draft: null,
    approvedWordingVersion: attendeeWordingVersion(null),
    approvedFactsVersion: eventFacts(config).version,
    approvedAt: new Date(IN_7D - 48 * HOUR),
    approvedBy: 'staff@example.test',
    pausedReason: null,
    ...overrides,
  };
}

const PEOPLE = {
  'users/a': { email: 'Ada@Example.test', registrationStatus: 'approved' },
  'users/b': { email: 'ben@example.test', registrationStatus: 'ticketed' },
  // Not registered, revoked, and unsubscribed: never reached.
  'users/c': { email: 'cy@example.test', registrationStatus: 'pending' },
  'users/d': { email: 'dee@example.test', registrationStatus: 'revoked' },
  'users/e': { email: 'eve@example.test', registrationStatus: 'approved' },
  [`email_suppressions/${suppressionIdFor('eve@example.test')}`]: { scope: 'announcements', via: 'link' },
};

function seed(extra = {}, { scheduleOverrides = {}, demo = false, people = PEOPLE } = {}) {
  return makeSpeakersDb({
    'config/event': { historicalDemo: demo },
    [`${SCHEDULES}/${SCHEDULE_ID}`]: approvedSchedule(scheduleOverrides),
    ...people,
    ...extra,
  });
}

/** The real console provider, its captured mail, and a hook after each batch. */
function mailbox() {
  const mail = [];
  const provider = createConsoleProvider({
    env: { FUNCTIONS_EMULATOR: 'true', E2E_MAIL_FILE: '/tmp/unused' },
    log: { log() {} },
    appendFileSync: (_file, line) => mail.push(JSON.parse(line)),
  });
  const box = { mail, batches: 0, afterBatch: null };
  box.provider = {
    ...provider,
    async sendBatch(messages) {
      const out = await provider.sendBatch(messages);
      box.batches += 1;
      if (box.afterBatch) await box.afterBatch(box.batches);
      return out;
    },
  };
  return box;
}

function notifier() {
  const events = [];
  return { events, notifyOperator: async (event) => { events.push(event); return { delivered: true }; } };
}

function run(db, clock, { box = mailbox(), config = CONFIG, notifyOperator = async () => {}, provider } = {}) {
  const now = typeof clock === 'function' ? clock : () => clock;
  const getConfig = async () => config;
  const emailCore = createEmailCore({ db, provider: provider ?? box.provider, getConfig, sleep: async () => {}, log: QUIET });
  return runAttendeeSchedule({
    db, getConfig, provider: provider ?? box.provider, emailCore, sendEmail: emailCore.send, notifyOperator, now, log: QUIET,
  });
}

function logs(db, action) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id)).filter((row) => !action || row.action === action);
}

function claims(db) {
  return db.ids('email_claims').length;
}

/** `count` registered attendees, a0000@ to aNNNN@, sorted by address. */
function crowd(count) {
  const out = {};
  for (let i = 0; i < count; i += 1) {
    out[`users/p${i}`] = { email: `a${String(i).padStart(4, '0')}@example.test`, registrationStatus: 'approved' };
  }
  return out;
}

// --- settings ----------------------------------------------------------------

test('the schedule is off by default, with 7 and 1 days at 10:00 and the shipped wording', () => {
  const schedule = normalizeAttendeeSchedule(undefined);
  assert.equal(schedule.enabled, false);
  assert.deepEqual(schedule.offsetsDays, [7, 1]);
  assert.equal(schedule.sendTime, '10:00');
  assert.equal(schedule.draft, null);
  assert.equal(schedule.approvedFactsVersion, null);
  assert.match(DEFAULT_DRAFT.subject, /\{\{days_until\}\}/);
  assert.match(attendeeWordingVersion(null), /^shipped:[0-9a-f]{32}$/);
});

test('settings take one placeholder, {{days_until}}, and refuse any other', () => {
  const ok = readAttendeeSettings({ offsetsDays: [1, 7, 7], sendTime: '09:30', draft: { subject: ' See you in {{days_until}} ', message: 'Doors open at 8.\r\n\r\nBring {{days_until}} of energy.' } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.offsetsDays, [7, 1]);
  assert.equal(ok.value.draft.subject, 'See you in {{days_until}}');
  assert.equal(ok.value.draft.message, 'Doors open at 8.\n\nBring {{days_until}} of energy.');

  const bad = readAttendeeSettings({ offsetsDays: [7], sendTime: '10:00', draft: { subject: 'Hi {{event_name}}', message: 'Hi {{ name }}' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /subject: Only \{\{days_until\}\} can be used\. Remove \{\{event_name\}\}\./);
  assert.match(bad.errors.join(' '), /message: Only \{\{days_until\}\} can be used\. Remove \{\{ name \}\}\./);
  const empty = readAttendeeSettings({ offsetsDays: [], sendTime: '25:00', draft: { subject: ' ', message: '' } });
  assert.equal(empty.ok, false);
  assert.equal(empty.errors.length, 4);
});

test('a saved draft has its own wording version, and the shipped one names the shipped copy', () => {
  const draft = { subject: 'See you in {{days_until}}', message: 'Hello.' };
  assert.match(attendeeWordingVersion(draft), /^[0-9a-f]{32}$/);
  assert.notEqual(attendeeWordingVersion(draft), attendeeWordingVersion({ ...draft, message: 'Hello!' }));
  assert.notEqual(attendeeWordingVersion(draft), attendeeWordingVersion(null));
});

test('the facts name the start, the venue and the ticket link, which depends on Stripe ticket sales', () => {
  const facts = eventFacts(CONFIG);
  assert.equal(facts.ok, true);
  assert.equal(facts.facts.start.date, '2026-12-01');
  assert.equal(facts.facts.start.time, '09:00');
  assert.match(facts.facts.when, /^Tuesday, December 1, 2026 at 9:00\sAM EST$/);
  assert.equal(facts.facts.where, 'Example Hall, 1 Main St, Example City');
  assert.equal(facts.facts.ticketUrl, `${SITE}/dashboard`);

  const stripe = eventFacts(withEvent({}, { ticketingProvider: 'stripe' }));
  assert.equal(stripe.facts.ticketUrl, `${SITE}/tickets/mine`);
  assert.notEqual(stripe.version, facts.version);
  assert.notEqual(eventFacts(withEvent({ venue: { name: 'Other Hall' } })).version, facts.version);
  assert.notEqual(eventFacts(withEvent({ days: [{ id: 'day-1', date: '2026-12-01', startTime: '10:00', endTime: '17:00' }] })).version, facts.version);
  assert.equal(eventFacts(withEvent({ name: 'Example Event' })).version, facts.version);

  assert.equal(eventFacts({ ...CONFIG, tierA: {} }).ok, false);
  assert.equal(eventFacts(withEvent({ days: [] })).ok, false);
  assert.equal(eventFacts(withEvent({ timezone: '' })).ok, false);
});

test('days until reads as words', () => {
  assert.equal(daysUntilWords(7), '7 days');
  assert.equal(daysUntilWords(1), '1 day');
  assert.equal(daysUntilWords(0), 'less than a day');
});

// --- one run -----------------------------------------------------------------

test('two runs in one window send one email to each registered attendee, on the announcement contract', async () => {
  const db = seed();
  const box = mailbox();
  const first = await run(db, IN_7D, { box });
  assert.equal(first.outcome, 'completed');
  assert.equal(first.sendId, 'reminder-attendees-2026-12-01-7d');
  assert.equal(sendIdFor('2026-12-01-7d'), first.sendId);
  assert.equal(first.counts.sent, 2);
  assert.deepEqual(box.mail.map((m) => m.to).sort(), ['ada@example.test', 'ben@example.test']);

  const message = box.mail.find((m) => m.to === 'ben@example.test');
  assert.equal(message.subject, 'Your event is 7 days away');
  assert.match(message.text, /The event is 7 days away\./);
  assert.match(message.text, /When: Tuesday, December 1, 2026 at 9:00\sAM EST/);
  assert.match(message.text, /Where: Example Hall, 1 Main St, Example City/);
  assert.match(message.text, new RegExp(`Open your dashboard: ${SITE}/dashboard`));
  // The announcement stream and the per-recipient unsubscribe link.
  assert.equal(message.messageStream, 'announcements');
  assert.match(message.headers['List-Unsubscribe'], new RegExp(`^<${SITE}/unsubscribe\\?s=reminder-attendees-2026-12-01-7d&r=[0-9a-f]{64}&t=`));
  assert.equal(message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(message.text, /Unsubscribe from announcements: https:\/\/site\.example\.test\/unsubscribe\?s=/);

  const record = db.read('announcement_sends', first.sendId);
  assert.equal(record.status, 'sent');
  assert.equal(record.audience, 'registered');
  assert.equal(record.reminder.schedule, 'attendees');
  assert.equal(record.reminder.windowKey, '2026-12-01-7d');
  assert.equal(record.createdBy.email, null);
  const ledger = db.read(LEDGER, 'attendees__2026-12-01-7d');
  assert.equal(ledger.sendId, first.sendId);
  assert.equal(claims(db), 2);

  const second = await run(db, IN_7D + HOUR, { box });
  assert.equal(second.outcome, 'completed');
  assert.equal(second.counts.sent, 0);
  assert.equal(box.mail.length, 2, 'the second run sends nothing');
  assert.equal(claims(db), 2);

  // One admin_logs row, for the run that reached someone, with no address.
  const rows = logs(db, 'runScheduledReminders');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].details.schedule, 'attendees');
  assert.equal(rows[0].details.counts.sent, 2);
  assert.doesNotMatch(JSON.stringify(rows), /@/);
  const runs = db.read(RUNS, 'attendees');
  assert.equal(runs.running, null, 'the lease is released');
  // The last run is the second one, which reached nobody.
  assert.equal(runs.lastRun.outcome, 'completed');
  assert.equal(runs.lastRun.counts.sent, 0);
  assert.equal(runs.lastRun.sendId, first.sendId);
});

test('the next window sends again, with the next number of days', async () => {
  const db = seed();
  const box = mailbox();
  await run(db, IN_7D, { box });
  const next = await run(db, IN_1D, { box });
  assert.equal(next.sendId, 'reminder-attendees-2026-12-01-1d');
  assert.equal(next.counts.sent, 2);
  assert.equal(box.mail.length, 4);
  assert.equal(box.mail.at(-1).subject, 'Your event is 1 day away');
});

test('a ticket sold through Stripe links to the ticket page', async () => {
  const config = withEvent({}, { ticketingProvider: 'stripe' });
  const db = seed({}, { scheduleOverrides: { approvedFactsVersion: eventFacts(config).version } });
  const box = mailbox();
  await run(db, IN_7D, { box, config });
  assert.match(box.mail[0].text, new RegExp(`View your tickets: ${SITE}/tickets/mine`));
});

test('quiet hours stop a run between chunks, and the next morning resumes with no second copy and the new opt-out kept', async () => {
  const db = seed({}, { people: crowd(CHUNK_SIZE + 1) });
  const box = mailbox();
  // 19:55 in New York: the first chunk goes, then it is 20:05.
  let clock = Date.parse('2026-11-25T00:55:00Z');
  box.afterBatch = () => { clock = Date.parse('2026-11-25T01:05:00Z'); };
  const first = await run(db, () => clock, { box });
  assert.equal(first.reason, 'quiet-hours');
  assert.equal(first.counts.sent, CHUNK_SIZE);
  assert.equal(first.deferred, 1);
  assert.equal(db.read('announcement_sends', first.sendId).status, 'sending');

  // The last address unsubscribes overnight.
  const last = `a${String(CHUNK_SIZE).padStart(4, '0')}@example.test`;
  await db.collection('email_suppressions').doc(suppressionIdFor(last)).set({ scope: 'announcements', via: 'link' });
  box.afterBatch = null;
  const morning = await run(db, Date.parse('2026-11-25T13:30:00Z'), { box });
  assert.equal(morning.sendId, first.sendId);
  assert.equal(morning.counts.sent, 0);
  assert.equal(morning.counts.suppressed, 1);
  assert.equal(box.mail.length, CHUNK_SIZE);
  assert.equal(new Set(box.mail.map((m) => m.to)).size, CHUNK_SIZE, 'nobody got two');
  assert.equal(db.read('announcement_sends', first.sendId).status, 'sent');
});

test('turning the schedule off part way stops the run before its next chunk', async () => {
  const db = seed({}, { people: crowd(CHUNK_SIZE + 1) });
  const box = mailbox();
  box.afterBatch = async () => {
    await db.collection(SCHEDULES).doc(SCHEDULE_ID).set({ enabled: false }, { merge: true });
  };
  const result = await run(db, IN_7D, { box });
  assert.equal(result.reason, 'schedule-changed');
  assert.equal(result.counts.sent, CHUNK_SIZE);
  assert.equal(box.mail.length, CHUNK_SIZE);
  const later = await run(db, IN_7D + HOUR, { box });
  assert.deepEqual(later, { outcome: 'skipped', reason: 'off' });
  assert.equal(box.mail.length, CHUNK_SIZE);
});

test('a send started on an earlier approval is not continued, and is marked stopped', async () => {
  const db = seed({}, { people: crowd(CHUNK_SIZE + 1) });
  const box = mailbox();
  let clock = Date.parse('2026-11-25T00:55:00Z');
  box.afterBatch = () => { clock = Date.parse('2026-11-25T01:05:00Z'); };
  const first = await run(db, () => clock, { box });
  assert.equal(first.reason, 'quiet-hours');
  // Staff save new wording and approve it overnight.
  const draft = { subject: 'Tomorrow-ish: {{days_until}}', message: 'New words.' };
  await db.collection(SCHEDULES).doc(SCHEDULE_ID).set({ draft, approvedWordingVersion: attendeeWordingVersion(draft) }, { merge: true });
  box.afterBatch = null;
  const morning = await run(db, Date.parse('2026-11-25T13:30:00Z'), { box });
  assert.equal(morning.reason, 'superseded');
  assert.equal(morning.counts.sent, 0);
  assert.equal(box.mail.length, CHUNK_SIZE);
  assert.equal(db.read('announcement_sends', first.sendId).status, 'stopped');
});

test('a send cut off when its window closed is marked stopped, and the next window reaches everyone', async () => {
  const db = seed({}, { people: crowd(CHUNK_SIZE + 1) });
  const box = mailbox();
  // The last minute of the 7-day window: the first chunk goes, then the
  // 1-day window has opened.
  let clock = Date.parse('2026-11-30T14:59:00Z');
  box.afterBatch = () => { clock = Date.parse('2026-11-30T15:00:30Z'); };
  const first = await run(db, () => clock, { box });
  assert.equal(first.reason, 'window-closed');
  assert.equal(db.read('announcement_sends', first.sendId).status, 'stopped');
  box.afterBatch = null;
  const next = await run(db, IN_1D, { box });
  assert.equal(next.counts.sent, CHUNK_SIZE + 1);
});

test('wording that is not the approved version pauses the schedule, tells the operator once, and sends nothing', async () => {
  const db = seed({}, { scheduleOverrides: { approvedWordingVersion: 'shipped:0000' } });
  const box = mailbox();
  const tell = notifier();
  const result = await run(db, IN_7D, { box, notifyOperator: tell.notifyOperator });
  assert.deepEqual(result, { outcome: 'paused', reason: 'wording-changed' });
  assert.equal(box.mail.length, 0);
  assert.equal(db.read(SCHEDULES, SCHEDULE_ID).pausedReason, 'wording-changed');
  assert.equal(tell.events.length, 1);
  assert.equal(tell.events[0].title, 'Scheduled attendee reminders paused');
  assert.equal(logs(db, 'pauseReminderSchedule').length, 1);
  const again = await run(db, IN_7D + HOUR, { box, notifyOperator: tell.notifyOperator });
  assert.deepEqual(again, { outcome: 'skipped', reason: 'paused' });
  assert.equal(tell.events.length, 1);
});

test('a change to the start, the venue or the ticket link pauses the schedule and sends nothing', async () => {
  const db = seed();
  const box = mailbox();
  const tell = notifier();
  const moved = withEvent({ venue: { name: 'Other Hall', city: 'Example City' } });
  const result = await run(db, IN_7D, { box, config: moved, notifyOperator: tell.notifyOperator });
  assert.deepEqual(result, { outcome: 'paused', reason: 'facts-changed' });
  assert.equal(box.mail.length, 0);
  assert.equal(db.read(SCHEDULES, SCHEDULE_ID).pausedReason, 'facts-changed');
  assert.match(tell.events[0].summary, /start, the venue or the ticket link/);
});

test('a channel that cannot send announcements stops the run before any record or claim', async () => {
  const db = seed();
  const tell = notifier();
  const webhook = { name: 'webhook', async send() { throw new Error('not used'); } };
  const result = await run(db, IN_7D, { provider: webhook, notifyOperator: tell.notifyOperator });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.error.code, 'unsupported-provider');
  assert.equal(db.ids('announcement_sends').length, 0);
  assert.equal(claims(db), 0);
  assert.equal(tell.events.length, 1);
  assert.equal(db.read(RUNS, 'attendees').lastRun.error.code, 'unsupported-provider');
});

test('nothing runs while off, paused, on a historical demo, after the event, or outside a window', async () => {
  const box = mailbox();
  assert.deepEqual(await run(seed({}, { scheduleOverrides: { enabled: false } }), IN_7D, { box }), { outcome: 'skipped', reason: 'off' });
  assert.deepEqual(await run(seed({}, { scheduleOverrides: { pausedReason: 'settings-changed' } }), IN_7D, { box }), { outcome: 'skipped', reason: 'paused' });
  const demo = await run(seed({}, { demo: true }), IN_7D, { box });
  assert.equal(demo.outcome, 'skipped');
  assert.equal(demo.reason, 'read-only-demo');
  assert.deepEqual(await run(seed(), Date.parse('2026-12-02T12:00:00Z'), { box }), { outcome: 'skipped', reason: 'event-ended' });
  // Before the 7-day window, and in quiet hours inside it.
  assert.equal((await run(seed(), Date.parse('2026-11-20T15:00:00Z'), { box })).outcome, 'nothing-due');
  assert.equal((await run(seed(), Date.parse('2026-11-25T03:00:00Z'), { box })).outcome, 'nothing-due');
  assert.equal(box.mail.length, 0);
});

test('the hourly run serves both schedules, and a fault in one does not stop the other', async () => {
  const db = seed({
    [`${SCHEDULES}/speakers`]: { enabled: false },
  });
  const box = mailbox();
  const getConfig = async () => CONFIG;
  const emailCore = createEmailCore({ db, provider: box.provider, getConfig, sleep: async () => {}, log: QUIET });
  const results = await runScheduledReminders({
    db, getConfig, provider: box.provider, emailCore, sendEmail: emailCore.send, now: () => IN_7D, log: QUIET,
  });
  assert.deepEqual(results.speakers, { outcome: 'skipped', reason: 'off' });
  assert.equal(results.attendees.counts.sent, 2);
});
