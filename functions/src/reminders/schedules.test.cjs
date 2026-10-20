'use strict';

// The `reminderSchedules` staff endpoint (issue #518) against the
// in-memory fake: who may call it, the settings and their limits, the
// preview per offset, approval of the previewed wording and settings only,
// turning it off, the pause on a settings change, the demo refusal, and the
// next-run panel.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSpeakersDb } = require('../speakers/speakersFake.cjs');
const { resetTemplateCacheForTest } = require('../email/templates.cjs');
const { REMINDERS, wordingVersion } = require('../speakers/reminderCore.cjs');
const { SCHEDULES, LEDGER } = require('./speakerSchedule.cjs');
const { createReminderSchedulesHandler } = require('./schedules.cjs');

const QUIET = { error() {}, warn() {}, info() {} };
const ZONE = 'America/New_York';
const DUE_AT = '2026-11-20T22:00:00.000Z';
const NOW = Date.parse('2026-11-01T15:00:00Z');
const HOUR = 3_600_000;

const CONFIG = {
  event: {
    name: 'Example Event',
    timezone: ZONE,
    sender: { email: 'events@example.test', name: 'Example Event' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.test' },
    days: [{ id: 'day-1', date: '2026-12-01', startTime: '09:00', endTime: '17:00' }],
    social: { handles: [] },
  },
  theme: { colors: {} },
  tierA: { publicUrl: 'https://site.example.test' },
};

const TOKENS = {
  staff: { uid: 'staff-1', email: 'staff@example.test', email_verified: true },
  stranger: { uid: 'user-1', email: 'someone@example.test', email_verified: true },
};
const auth = { async verifyIdToken(token) { if (!TOKENS[token]) throw new Error('bad'); return TOKENS[token]; } };

function seed(extra = {}, { demo = false } = {}) {
  resetTemplateCacheForTest();
  return makeSpeakersDb({
    'config/bootstrap': { adminEmails: ['operator@example.test'], staffEmails: ['staff@example.test'] },
    'config/event': { historicalDemo: demo },
    'speakers/ada': { firstName: 'Ada', lastName: 'Example', email: 'ada@example.test', status: 'accepted', bio: '', headshotPath: '' },
    'speakers/ben': { firstName: 'Ben', lastName: 'Example', email: 'ben@example.test', status: 'accepted', bio: '', headshotPath: 'b.jpg' },
    ...extra,
  });
}

async function call(db, body, { token = 'staff', now = NOW, method = 'POST' } = {}) {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
    set() { return res; },
  };
  await createReminderSchedulesHandler({ db, auth, getConfig: async () => CONFIG, now: () => now, log: QUIET })(
    { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: { schedule: 'speakers', ...body } },
    res,
  );
  return res;
}

const SETTINGS = { offsetsDays: [14, 7, 2], sendTime: '10:00', dueAt: DUE_AT, topics: ['bio', 'headshot'] };

function logs(db, action) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id)).filter((row) => row.action === action);
}

test('only staff and operators reach the endpoint, by POST, with a known action and schedule', async () => {
  const db = seed();
  assert.equal((await call(db, { action: 'get' }, { token: null })).statusCode, 401);
  assert.equal((await call(db, { action: 'get' }, { token: 'stranger' })).statusCode, 403);
  assert.equal((await call(db, { action: 'get' }, { method: 'GET' })).statusCode, 405);
  assert.equal((await call(db, { action: 'send' })).statusCode, 400);
  assert.equal((await call(db, { action: 'get', schedule: 'organizers' })).statusCode, 400);
});

test('get: off by default, with the default offsets, send time and items', async () => {
  const res = await call(seed(), { action: 'get' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, 'off');
  assert.deepEqual(res.body.settings, { offsetsDays: [14, 7, 2], sendTime: '10:00', dueAt: null, topics: ['bio', 'headshot', 'description', 'materials'] });
  assert.equal(res.body.timeZone, ZONE);
  assert.equal(res.body.nextRun.status, 'not-set');
  assert.equal(res.body.lastRun, null);
  assert.equal(res.body.wording.version, wordingVersion(null));
  assert.equal(res.body.wording.matchesApproval, false);
});

test('save checks every field and writes an admin_logs row', async () => {
  const db = seed();
  const bad = await call(db, { action: 'save', offsetsDays: [400], sendTime: '7pm', dueAt: 'soon', topics: [] });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error.message, /offsetsDays.*sendTime.*dueAt.*topics/);
  const ok = await call(db, { action: 'save', ...SETTINGS });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body.settings, SETTINGS);
  assert.equal(ok.body.state, 'off');
  assert.equal(logs(db, 'saveReminderSchedule').length, 1);
  assert.equal(db.read(SCHEDULES, 'speakers').updatedBy, 'staff@example.test');
});

test('preview: one sample per offset, the due date and days left in each, and the versions an approval needs', async () => {
  const db = seed();
  await call(db, { action: 'save', ...SETTINGS });
  const res = await call(db, { action: 'preview' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.samples.map((s) => s.offsetDays), [14, 7, 2]);
  assert.deepEqual(res.body.samples.map((s) => s.daysLeft), [14, 7, 2]);
  assert.equal(res.body.samples[1].fireAt, '2026-11-13T15:00:00.000Z');
  assert.equal(res.body.audienceCount, 2);
  // The first speaker who would get one is the sample.
  assert.equal(res.body.samples[0].speakerName, 'Ada Example');
  assert.equal(res.body.samples[0].sample, false);
  assert.match(res.body.samples[0].text, /Please send them by Friday, November 20, 2026/);
  assert.equal(res.body.wordingVersion, wordingVersion(null));
  assert.match(res.body.settingsVersion, /^[0-9a-f]{32}$/);
});

test('preview with nobody owing anything shows a sample speaker, and refuses without a due date', async () => {
  const empty = seed({ 'speakers/ada': { status: 'accepted', email: 'a@example.test', bio: 'x', headshotPath: 'y' }, 'speakers/ben': { status: 'removed' } });
  assert.equal((await call(empty, { action: 'preview' })).statusCode, 409);
  await call(empty, { action: 'save', ...SETTINGS });
  const res = await call(empty, { action: 'preview' });
  assert.equal(res.body.audienceCount, 0);
  assert.equal(res.body.samples[0].sample, true);
  assert.equal(res.body.samples[0].speakerName, 'Sample Speaker');
  assert.equal(res.body.samples[0].to, null);
});

test('approve turns the schedule on for the previewed wording and settings only', async () => {
  const db = seed();
  await call(db, { action: 'save', ...SETTINGS });
  const preview = (await call(db, { action: 'preview' })).body;

  const missing = await call(db, { action: 'approve' });
  assert.equal(missing.statusCode, 400);

  // Wording saved after the preview: refused.
  await db.collection('email_templates').doc('speaker.reminder').set({ subject: 'Changed {{event_name}}' });
  const staleWording = await call(db, { action: 'approve', wordingVersion: preview.wordingVersion, settingsVersion: preview.settingsVersion });
  assert.equal(staleWording.statusCode, 409);
  assert.match(staleWording.body.error.message, /wording changed/);
  await db.collection('email_templates').doc('speaker.reminder').delete();

  // Settings saved after the preview: refused.
  await call(db, { action: 'save', ...SETTINGS, sendTime: '11:00' });
  const staleSettings = await call(db, { action: 'approve', wordingVersion: preview.wordingVersion, settingsVersion: preview.settingsVersion });
  assert.equal(staleSettings.statusCode, 409);
  assert.match(staleSettings.body.error.message, /settings changed/);
  assert.equal(db.read(SCHEDULES, 'speakers').enabled, undefined);

  const fresh = (await call(db, { action: 'preview' })).body;
  const ok = await call(db, { action: 'approve', wordingVersion: fresh.wordingVersion, settingsVersion: fresh.settingsVersion });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.state, 'on');
  assert.equal(ok.body.approval.wordingVersion, wordingVersion(null));
  assert.equal(ok.body.approval.by, 'staff@example.test');
  assert.equal(ok.body.wording.matchesApproval, true);
  assert.equal(logs(db, 'approveReminderSchedule').length, 1);
});

test('approve refuses when no reminder is left before the due date', async () => {
  const db = seed();
  await call(db, { action: 'save', ...SETTINGS, dueAt: '2026-11-02T22:00:00.000Z' });
  const preview = (await call(db, { action: 'preview' })).body;
  const res = await call(db, { action: 'approve', wordingVersion: preview.wordingVersion, settingsVersion: preview.settingsVersion }, { now: NOW + 2 * 24 * HOUR });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error.message, /No reminder is left/);
});

test('a settings change while on pauses the schedule; turning it off clears the pause', async () => {
  const db = seed();
  await call(db, { action: 'save', ...SETTINGS });
  const preview = (await call(db, { action: 'preview' })).body;
  await call(db, { action: 'approve', wordingVersion: preview.wordingVersion, settingsVersion: preview.settingsVersion });
  // The same settings again change nothing.
  assert.equal((await call(db, { action: 'save', ...SETTINGS })).body.state, 'on');
  const changed = await call(db, { action: 'save', ...SETTINGS, offsetsDays: [7] });
  assert.equal(changed.body.state, 'paused');
  assert.equal(changed.body.paused.reason, 'settings-changed');
  assert.match(changed.body.paused.message, /settings changed/);
  const off = await call(db, { action: 'disable' });
  assert.equal(off.body.state, 'off');
  assert.equal(off.body.paused, null);
  assert.equal(logs(db, 'disableReminderSchedule').length, 1);
});

test('a historical demo refuses every write and stores nothing', async () => {
  const db = seed({}, { demo: true });
  for (const body of [{ action: 'save', ...SETTINGS }, { action: 'approve', wordingVersion: 'x', settingsVersion: 'y' }, { action: 'disable' }]) {
    const res = await call(db, body);
    assert.equal(res.statusCode, 403, body.action);
    assert.equal(res.body.error.code, 'read-only-demo');
  }
  assert.equal(db.read(SCHEDULES, 'speakers'), undefined);
});

test('the next-run panel names the offset, who it reaches, and who waits on the cooldown', async () => {
  const db = seed({
    // Reminded by staff an hour before the 14-day window opens.
    [`${REMINDERS}/ben`]: { lastStatus: 'sent', lastBatchId: 'manual-1', lastSentAt: new Date(Date.parse('2026-11-06T15:00:00Z') - HOUR) },
  });
  await call(db, { action: 'save', ...SETTINGS });
  const res = await call(db, { action: 'get' });
  assert.equal(res.body.nextRun.status, 'upcoming');
  assert.equal(res.body.nextRun.offsetDays, 14);
  assert.equal(res.body.nextRun.at, '2026-11-06T15:00:00.000Z');
  assert.deepEqual(res.body.nextRun.reach.names, ['Ada Example']);
  assert.deepEqual(res.body.nextRun.reach.waiting.map((row) => row.name), ['Ben Example']);
  assert.equal(res.body.nextRun.windows.length, 3);

  // Inside the window, a speaker with a ledger row is not counted again.
  const inWindow = Date.parse('2026-11-06T16:00:00Z');
  await db.collection(LEDGER).doc('speakers__2026-11-20-14d__ada').set({ scheduleId: 'speakers', windowKey: '2026-11-20-14d', speakerId: 'ada' });
  const inside = await call(db, { action: 'get' }, { now: inWindow });
  assert.equal(inside.body.nextRun.status, 'due');
  assert.equal(inside.body.nextRun.reach.count, 0);
  assert.equal(inside.body.nextRun.reach.waitingCount, 1, 'Ben still waits on the cooldown in this window');

  // Once the window has reached everyone, the panel shows the next day.
  await db.collection(LEDGER).doc('speakers__2026-11-20-14d__ben').set({ scheduleId: 'speakers', windowKey: '2026-11-20-14d', speakerId: 'ben' });
  const done = await call(db, { action: 'get' }, { now: inWindow });
  assert.equal(done.body.nextRun.status, 'upcoming');
  assert.equal(done.body.nextRun.offsetDays, 7);
  assert.equal(done.body.nextRun.at, '2026-11-13T15:00:00.000Z');
  assert.deepEqual(done.body.nextRun.reach.names, ['Ada Example', 'Ben Example']);
});

// Review findings on #528.

test('a committed approval answers 200 with the approved state even when the refresh read fails', async () => {
  const db = seed();
  await call(db, { action: 'save', ...SETTINGS });
  const preview = (await call(db, { action: 'preview' })).body;
  // The refresh after the commit reads reminder_schedule_runs; make it fail.
  const original = db.collection.bind(db);
  db.collection = (name) => {
    const col = original(name);
    if (name !== 'reminder_schedule_runs') return col;
    return { ...col, doc: () => ({ get: async () => { throw new Error('read failed'); } }) };
  };
  const res = await call(db, { action: 'approve', wordingVersion: preview.wordingVersion, settingsVersion: preview.settingsVersion });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, 'on');
  assert.match(res.body.refreshError, /could not be read/);
  assert.equal(db.read(SCHEDULES, 'speakers').enabled, true);
  for (const body of [{ action: 'disable' }, { action: 'save', ...SETTINGS, sendTime: '09:00' }]) {
    const out = await call(db, body);
    assert.equal(out.statusCode, 200, body.action);
    assert.ok(out.body.refreshError, body.action);
  }
  assert.equal(db.read(SCHEDULES, 'speakers').sendTime, '09:00');
});

test('a preview renders the days left at the moment each window opens, after quiet hours', async () => {
  const db = seed();
  // 21:00 is in quiet hours: each window opens at 08:00 the next morning,
  // one calendar day closer to the due date.
  await call(db, { action: 'save', ...SETTINGS, sendTime: '21:00' });
  const res = await call(db, { action: 'preview' });
  assert.deepEqual(res.body.samples.map((s) => s.daysLeft), [13, 6, 1]);
  assert.equal(res.body.samples[1].opensAt, '2026-11-14T13:00:00.000Z');
});

test('the last window, once it has reached everyone, reads as done, the same as no window left', async () => {
  const db = seed();
  await call(db, { action: 'save', ...SETTINGS });
  for (const id of ['ada', 'ben']) {
    await db.collection(LEDGER).doc(`speakers__2026-11-20-2d__${id}`).set({ scheduleId: 'speakers', windowKey: '2026-11-20-2d', speakerId: id });
  }
  const res = await call(db, { action: 'get' }, { now: Date.parse('2026-11-19T15:00:00Z') });
  assert.equal(res.body.nextRun.status, 'none');
  assert.equal(res.body.nextRun.message, 'No reminder is left before the due date.');
  assert.equal(res.body.nextRun.reach, undefined);
});
