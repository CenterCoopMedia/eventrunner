'use strict';

// The `reminderSchedules` endpoint for the attendee schedule (issue #518)
// against the in-memory fake: the settings and the wording with its one
// placeholder, the facts the server builds, a preview per reminder day,
// approval of the previewed wording, settings and facts only, the pauses on
// a change while on, the channel refusal, the demo refusal, and the next
// run.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSpeakersDb } = require('../speakers/speakersFake.cjs');
const { createConsoleProvider } = require('../email/providers/console.cjs');
const { suppressionIdFor } = require('../announcements/suppression.cjs');
const { SCHEDULES, RUNS } = require('./scheduleCore.cjs');
const { DEFAULT_DRAFT, attendeeWordingVersion, eventFacts } = require('./attendeeSchedule.cjs');
const { createReminderSchedulesHandler } = require('./schedules.cjs');

const QUIET = { error() {}, warn() {}, info() {}, log() {} };
const ZONE = 'America/New_York';
const NOW = Date.parse('2026-11-01T15:00:00Z');
const SITE = 'https://site.example.test';

const CONFIG = {
  event: {
    name: 'Example Event',
    timezone: ZONE,
    sender: { email: 'events@example.test', name: 'Example Event', replyTo: 'help@example.test' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.test' },
    days: [{ id: 'day-1', date: '2026-12-01', startTime: '09:00', endTime: '17:00' }],
    venue: { name: 'Example Hall', addressLine1: '1 Main St', city: 'Example City' },
    social: { handles: [] },
  },
  theme: { colors: {} },
  tierA: { publicUrl: SITE, ticketingProvider: 'manual' },
  providers: { email: { provider: 'console', messageStream: null, announcementStream: 'announcements' } },
};

const TOKENS = {
  staff: { uid: 'staff-1', email: 'staff@example.test', email_verified: true },
};
const auth = { async verifyIdToken(token) { if (!TOKENS[token]) throw new Error('bad'); return TOKENS[token]; } };

const consoleProvider = createConsoleProvider({
  env: { FUNCTIONS_EMULATOR: 'true', E2E_MAIL_FILE: '/tmp/unused' },
  log: { log() {} },
  appendFileSync: () => {},
});

function seed(extra = {}, { demo = false } = {}) {
  return makeSpeakersDb({
    'config/bootstrap': { adminEmails: ['operator@example.test'], staffEmails: ['staff@example.test'] },
    'config/event': { historicalDemo: demo },
    'users/a': { email: 'ada@example.test', registrationStatus: 'approved' },
    'users/b': { email: 'ben@example.test', registrationStatus: 'ticketed' },
    'users/c': { email: 'cy@example.test', registrationStatus: 'pending' },
    'users/e': { email: 'eve@example.test', registrationStatus: 'approved' },
    [`email_suppressions/${suppressionIdFor('eve@example.test')}`]: { scope: 'announcements', via: 'link' },
    ...extra,
  });
}

async function call(db, body, { now = NOW, config = CONFIG, provider = consoleProvider } = {}) {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    set() { return res; },
  };
  await createReminderSchedulesHandler({ db, auth, getConfig: async () => config, provider, now: () => now, log: QUIET })(
    { method: 'POST', headers: { authorization: 'Bearer staff' }, body: { schedule: 'attendees', ...body } },
    res,
  );
  return res;
}

const DRAFT = { subject: 'See you in {{days_until}}', message: 'We open the doors in {{days_until}}.' };
const SETTINGS = { offsetsDays: [7, 1], sendTime: '10:00', draft: DRAFT };

function logs(db, action) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id)).filter((row) => row.action === action);
}

async function approve(db, opts) {
  await call(db, { action: 'save', ...SETTINGS }, opts);
  const preview = (await call(db, { action: 'preview' }, opts)).body;
  const res = await call(db, {
    action: 'approve',
    wordingVersion: preview.wordingVersion,
    settingsVersion: preview.settingsVersion,
    factsVersion: preview.factsVersion,
  }, opts);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return { preview, res };
}

test('get: off by default, with 7 and 1 days, the shipped wording, the facts and the reach', async () => {
  const res = await call(seed(), { action: 'get' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.schedule, 'attendees');
  assert.equal(res.body.state, 'off');
  assert.deepEqual(res.body.settings, { offsetsDays: [7, 1], sendTime: '10:00', draft: { ...DEFAULT_DRAFT } });
  assert.equal(res.body.settings.draft.subject, DEFAULT_DRAFT.subject);
  assert.equal(res.body.wording.version, attendeeWordingVersion(null));
  assert.equal(res.body.wording.shipped, true);
  assert.equal(res.body.facts.ok, true);
  assert.match(res.body.facts.when, /^Tuesday, December 1, 2026 at 9:00\sAM EST$/);
  assert.equal(res.body.facts.where, 'Example Hall, 1 Main St, Example City');
  assert.equal(res.body.facts.ticketUrl, `${SITE}/dashboard`);
  assert.equal(res.body.facts.matchesApproval, false);
  assert.deepEqual(res.body.channel, { canSend: true, blocker: null, mode: 'app' });
  assert.equal(res.body.nextRun.status, 'upcoming');
  assert.equal(res.body.nextRun.offsetDays, 7);
  assert.equal(res.body.nextRun.at, '2026-11-24T15:00:00.000Z');
  // A count only: the panel never lists attendee addresses.
  assert.deepEqual(res.body.nextRun.reach, { count: 2, suppressed: 1, unusable: 0 });
  assert.doesNotMatch(JSON.stringify(res.body), /ada@example/);
  assert.equal(res.body.lastRun, null);
});

test('save checks the offsets, the send time and the wording, and writes an admin_logs row', async () => {
  const db = seed();
  const bad = await call(db, { action: 'save', offsetsDays: [0], sendTime: '7pm', draft: { subject: 'Hi {{event_name}}', message: '' } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /offsetsDays.*sendTime.*subject: Only \{\{days_until\}\}.*message/);
  const ok = await call(db, { action: 'save', ...SETTINGS });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body.settings, SETTINGS);
  assert.equal(ok.body.wording.shipped, false);
  assert.equal(ok.body.wording.version, attendeeWordingVersion(DRAFT));
  assert.equal(logs(db, 'saveReminderSchedule').length, 1);
  assert.equal(logs(db, 'saveReminderSchedule')[0].details.schedule, 'attendees');
  assert.equal(db.read(SCHEDULES, 'attendees').updatedBy, 'staff@example.test');
  // The speaker schedule is untouched.
  assert.equal(db.read(SCHEDULES, 'speakers'), undefined);
});

test('preview: one sample per reminder day, with the days, the facts, the ticket link and an inert unsubscribe link', async () => {
  const db = seed();
  await call(db, { action: 'save', ...SETTINGS });
  const res = await call(db, { action: 'preview' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.samples.map((s) => s.offsetDays), [7, 1]);
  assert.deepEqual(res.body.samples.map((s) => s.daysUntil), [7, 1]);
  assert.deepEqual(res.body.samples.map((s) => s.subject), ['See you in 7 days', 'See you in 1 day']);
  const seven = res.body.samples[0];
  assert.equal(seven.opensAt, '2026-11-24T15:00:00.000Z');
  assert.match(seven.text, /We open the doors in 7 days\./);
  assert.match(seven.text, /When: Tuesday, December 1, 2026 at 9:00\sAM EST/);
  assert.match(seven.text, /Where: Example Hall, 1 Main St, Example City/);
  assert.match(seven.text, new RegExp(`Open your dashboard: ${SITE}/dashboard`));
  assert.match(seven.text, new RegExp(`${SITE}/unsubscribe\\?test=1`));
  assert.match(seven.html, /We open the doors in 7 days\./);
  assert.equal(res.body.recipientCount, 2);
  assert.equal(res.body.suppressedCount, 1);
  assert.equal(res.body.from, 'Example Event <events@example.test>');
  assert.equal(res.body.stream, 'announcements');
  assert.match(res.body.unsubscribeNote, /own unsubscribe link/);
  assert.equal(res.body.canSend, true);
  assert.equal(res.body.wordingVersion, attendeeWordingVersion(DRAFT));
  assert.equal(res.body.factsVersion, eventFacts(CONFIG).version);
  assert.match(res.body.settingsVersion, /^[0-9a-f]{32}$/);
  // A preview sends nothing and records nothing.
  assert.equal(db.ids('announcement_sends').length, 0);
});

test('approve turns the schedule on for the previewed wording, settings and facts only', async () => {
  const db = seed();
  await call(db, { action: 'save', ...SETTINGS });
  const preview = (await call(db, { action: 'preview' })).body;
  const versions = { wordingVersion: preview.wordingVersion, settingsVersion: preview.settingsVersion, factsVersion: preview.factsVersion };

  assert.equal((await call(db, { action: 'approve', wordingVersion: versions.wordingVersion, settingsVersion: versions.settingsVersion })).statusCode, 400);

  const moved = { ...CONFIG, event: { ...CONFIG.event, venue: { name: 'Other Hall' } } };
  const staleFacts = await call(db, { action: 'approve', ...versions }, { config: moved });
  assert.equal(staleFacts.statusCode, 409);
  assert.match(staleFacts.body.error.message, /start, the venue or the ticket link changed/);

  await call(db, { action: 'save', ...SETTINGS, draft: { ...DRAFT, message: 'Other words.' } });
  const staleWording = await call(db, { action: 'approve', ...versions });
  assert.equal(staleWording.statusCode, 409);
  assert.match(staleWording.body.error.message, /wording changed/);

  await call(db, { action: 'save', ...SETTINGS, sendTime: '11:00' });
  const staleSettings = await call(db, { action: 'approve', ...versions });
  assert.equal(staleSettings.statusCode, 409);
  assert.equal(db.read(SCHEDULES, 'attendees').enabled, undefined);

  const { res } = await approve(db);
  assert.equal(res.body.state, 'on');
  assert.equal(res.body.approval.wordingVersion, attendeeWordingVersion(DRAFT));
  assert.equal(res.body.approval.factsVersion, eventFacts(CONFIG).version);
  assert.equal(res.body.wording.matchesApproval, true);
  assert.equal(res.body.facts.matchesApproval, true);
  assert.equal(db.read(SCHEDULES, 'attendees').approvedFactsVersion, eventFacts(CONFIG).version);
  assert.equal(logs(db, 'approveReminderSchedule').length, 1);
});

test('approve refuses when announcement email cannot be sent', async () => {
  const db = seed();
  await call(db, { action: 'save', ...SETTINGS });
  const webhook = { name: 'webhook', async send() {} };
  const preview = (await call(db, { action: 'preview' }, { provider: webhook })).body;
  assert.equal(preview.canSend, false);
  assert.match(preview.blocker, /webhook relay/);
  const res = await call(db, {
    action: 'approve', wordingVersion: preview.wordingVersion, settingsVersion: preview.settingsVersion, factsVersion: preview.factsVersion,
  }, { provider: webhook });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'unsupported-provider');
  assert.equal(db.read(SCHEDULES, 'attendees').enabled, undefined);
});

test('a wording or settings change while on pauses the schedule; turning it off clears the pause', async () => {
  const db = seed();
  await approve(db);
  assert.equal((await call(db, { action: 'save', ...SETTINGS })).body.state, 'on', 'the same values change nothing');
  const reworded = await call(db, { action: 'save', ...SETTINGS, draft: { ...DRAFT, subject: 'Soon: {{days_until}}' } });
  assert.equal(reworded.body.state, 'paused');
  assert.equal(reworded.body.paused.reason, 'wording-changed');
  assert.match(reworded.body.paused.message, /attendee reminder wording changed/);

  await approve(db);
  const moved = await call(db, { action: 'save', ...SETTINGS, offsetsDays: [3] });
  assert.equal(moved.body.paused.reason, 'settings-changed');

  const off = await call(db, { action: 'disable' });
  assert.equal(off.body.state, 'off');
  assert.equal(off.body.paused, null);
  assert.equal(logs(db, 'disableReminderSchedule').length, 1);
});

test('get says when the facts no longer match the approval', async () => {
  const db = seed();
  await approve(db);
  const moved = { ...CONFIG, event: { ...CONFIG.event, days: [{ id: 'day-1', date: '2026-12-02', startTime: '09:00', endTime: '17:00' }] } };
  const res = await call(db, { action: 'get' }, { config: moved });
  assert.equal(res.body.state, 'on');
  assert.equal(res.body.facts.matchesApproval, false);
});

test('a historical demo refuses every write and stores nothing', async () => {
  const db = seed({}, { demo: true });
  for (const body of [{ action: 'save', ...SETTINGS }, { action: 'approve', wordingVersion: 'x', settingsVersion: 'y', factsVersion: 'z' }, { action: 'disable' }]) {
    const res = await call(db, body);
    assert.equal(res.statusCode, 403, body.action);
    assert.equal(res.body.error.code, 'read-only-demo');
  }
  assert.equal(db.read(SCHEDULES, 'attendees'), undefined);
});

test('the next run moves on once the due window has sent, and the last run reads back', async () => {
  const db = seed({
    'announcement_sends/reminder-attendees-2026-12-01-7d': { status: 'sent', audience: 'registered', total: 2, nextIndex: 2 },
    [`${RUNS}/attendees`]: { lastRun: { outcome: 'completed', windowKey: '2026-12-01-7d', offsetDays: 7, counts: { sent: 2 }, finishedAt: new Date('2026-11-24T15:01:00Z') } },
  });
  const res = await call(db, { action: 'get' }, { now: Date.parse('2026-11-24T16:00:00Z') });
  assert.equal(res.body.nextRun.status, 'upcoming');
  assert.equal(res.body.nextRun.offsetDays, 1);
  assert.equal(res.body.lastRun.counts.sent, 2);
  const due = await call(seed(), { action: 'get' }, { now: Date.parse('2026-11-24T16:00:00Z') });
  assert.equal(due.body.nextRun.status, 'due');
  assert.equal(due.body.nextRun.offsetDays, 7);
});
