'use strict';

// The speaker reminder schedule (issue #518, ADR 0006) against the
// in-memory fake: two runs send once, the lease, the pauses, the demo
// refusal, an uncertain send is never sent again, and the 24-hour cooldown
// in both directions. tests/reminder-schedules.rules.test.js repeats the
// full run on the Firestore emulator.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSpeakersDb } = require('../speakers/speakersFake.cjs');
const { resetTemplateCacheForTest, getDefaultTemplate } = require('../email/templates.cjs');
const { REMINDERS, REMINDER_COOLDOWN_MS, reserve, wordingVersion } = require('../speakers/reminderCore.cjs');
const {
  SCHEDULES,
  RUNS,
  LEDGER,
  LEASE_MS,
  normalizeSpeakerSchedule,
  readSpeakerSettings,
  batchIdFor,
  calendarDaysLeft,
  eventEnded,
  pauseIfWordingChanged,
  runSpeakerSchedule,
} = require('./speakerSchedule.cjs');
const { runScheduledReminders } = require('./run.cjs');

const QUIET = { error() {}, warn() {}, info() {} };
const ZONE = 'America/New_York';
// Due Friday 2026-11-20 at 17:00 in New York (EST, UTC-5).
const DUE_AT = '2026-11-20T22:00:00.000Z';
// The 7-day window opens 2026-11-13 at 10:00 EST (15:00Z) and closes when
// the 2-day window opens, 2026-11-18 at 10:00 EST.
const IN_7D = Date.parse('2026-11-13T15:30:00Z');
const IN_2D = Date.parse('2026-11-18T15:30:00Z');
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

function schedule(overrides = {}) {
  return {
    enabled: true,
    offsetsDays: [14, 7, 2],
    sendTime: '10:00',
    dueAt: DUE_AT,
    topics: ['bio', 'headshot', 'description', 'materials'],
    approvedWordingVersion: wordingVersion(null),
    approvedAt: new Date(IN_7D - 48 * HOUR),
    approvedBy: 'staff@example.test',
    pausedReason: null,
    ...overrides,
  };
}

function seed(extra = {}, { scheduleOverrides = {}, demo = false } = {}) {
  resetTemplateCacheForTest();
  return makeSpeakersDb({
    'config/event': { historicalDemo: demo },
    [`${SCHEDULES}/speakers`]: schedule(scheduleOverrides),
    // Owes a biography and a headshot.
    'speakers/ada': { firstName: 'Ada', lastName: 'Example', email: 'ada@example.test', status: 'accepted', bio: '', headshotPath: '' },
    // Owes nothing.
    'speakers/ben': { firstName: 'Ben', lastName: 'Example', email: 'ben@example.test', status: 'accepted', bio: 'Bio.', headshotPath: 'speakers/ben.jpg' },
    // Not accepted yet.
    'speakers/cy': { firstName: 'Cy', lastName: 'Example', email: 'cy@example.test', status: 'invited', bio: '', headshotPath: '' },
    ...extra,
  });
}

function outbox(result = () => ({ status: 'sent' })) {
  const sent = [];
  const sendEmail = async (message) => {
    sent.push(message);
    return result(message, sent.length);
  };
  return { sent, sendEmail };
}

function notifier() {
  const events = [];
  return { events, notifyOperator: async (event) => { events.push(event); return { delivered: true }; } };
}

function run(db, nowMs, { sendEmail, notifyOperator = async () => {}, config = CONFIG } = {}) {
  return runSpeakerSchedule({ db, getConfig: async () => config, sendEmail, notifyOperator, now: () => nowMs, log: QUIET });
}

function logs(db, action) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id)).filter((row) => !action || row.action === action);
}

test('two runs in one window send one reminder, with the ledger row made in the reservation', async () => {
  const db = seed();
  const mail = outbox();
  const first = await run(db, IN_7D, mail);
  assert.equal(first.outcome, 'completed');
  assert.deepEqual(first.sent, ['ada']);
  assert.equal(first.batchId, 'sched-20261120-7d');
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'ada@example.test');
  assert.equal(mail.sent[0].onceKey, 'speaker-reminder:ada:sched-20261120-7d');
  // The due date is in the message, on the event clock.
  assert.match(mail.sent[0].text, /Please send them by Friday, November 20, 2026 at 5:00\sPM EST\./);
  const ledger = db.read(LEDGER, 'speakers__2026-11-20-7d__ada');
  assert.equal(ledger.batchId, 'sched-20261120-7d');
  assert.equal(ledger.outcome, 'sent');
  assert.equal(db.read(REMINDERS, 'ada').lastBatchId, 'sched-20261120-7d');

  const second = await run(db, IN_7D + HOUR, mail);
  assert.equal(second.outcome, 'completed');
  assert.deepEqual(second.sent, []);
  assert.equal(mail.sent.length, 1, 'the second run sends nothing');
  // One admin_logs row, for the run that reached someone.
  const rows = logs(db, 'runScheduledReminders');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].details.sent, ['ada']);
  assert.equal(rows[0].uid, null);
  const lastRun = db.read(RUNS, 'speakers').lastRun;
  assert.equal(lastRun.outcome, 'completed');
  assert.equal(db.read(RUNS, 'speakers').running, null, 'the lease is released');
});

test('the next window sends again, and a speaker who finished gets nothing', async () => {
  const db = seed();
  const mail = outbox();
  await run(db, IN_7D, mail);
  const next = await run(db, IN_2D, mail);
  assert.deepEqual(next.sent, ['ada']);
  assert.equal(next.batchId, 'sched-20261120-2d');
  assert.match(mail.sent[1].text, /Please send them by/);

  const done = seed({
    'speakers/ada': { firstName: 'Ada', lastName: 'Example', email: 'ada@example.test', status: 'accepted', bio: 'Bio.', headshotPath: 'x.jpg' },
  });
  const quiet = outbox();
  const result = await run(done, IN_7D, quiet);
  assert.equal(result.outcome, 'completed');
  assert.equal(quiet.sent.length, 0);
  assert.equal(logs(done, 'runScheduledReminders').length, 0, 'a run that reached nobody writes no admin_logs row');
});

test('a run holds a lease: a second run while it is held sends nothing', async () => {
  const db = seed({ [`${RUNS}/speakers`]: { running: { startedAt: new Date(IN_7D - 60_000) } } });
  const mail = outbox();
  assert.deepEqual(await run(db, IN_7D, mail), { outcome: 'skipped', reason: 'busy' });
  assert.equal(mail.sent.length, 0);
  // A lease older than LEASE_MS is abandoned and taken over.
  const stale = seed({ [`${RUNS}/speakers`]: { running: { startedAt: new Date(IN_7D - LEASE_MS) } } });
  assert.equal((await run(stale, IN_7D, mail)).outcome, 'completed');
  assert.equal(mail.sent.length, 1);
});

test('wording that is not the approved version pauses the schedule, logs it, tells the operator once, and sends nothing', async () => {
  const db = seed({
    'email_templates/speaker.reminder': { subject: 'New subject for {{event_name}}' },
  });
  const mail = outbox();
  const ops = notifier();
  const result = await run(db, IN_7D, { ...mail, notifyOperator: ops.notifyOperator });
  assert.deepEqual(result, { outcome: 'paused', reason: 'wording-changed' });
  assert.equal(mail.sent.length, 0);
  const stored = normalizeSpeakerSchedule(db.read(SCHEDULES, 'speakers'));
  assert.equal(stored.enabled, true);
  assert.equal(stored.pausedReason, 'wording-changed');
  assert.equal(logs(db, 'pauseReminderSchedule').length, 1);
  assert.equal(ops.events.length, 1);
  assert.match(ops.events[0].title, /paused/);

  const again = await run(db, IN_7D + HOUR, { ...mail, notifyOperator: ops.notifyOperator });
  assert.deepEqual(again, { outcome: 'skipped', reason: 'paused' });
  assert.equal(ops.events.length, 1);
  assert.equal(logs(db, 'pauseReminderSchedule').length, 1);
});

test('an approval binds the wording actually sent: saved wording that fails its check sends the shipped copy under the shipped version', async () => {
  const broken = { subject: 'Hi', html: '<p>No link.</p>', text: 'No link.' };
  // Approved on the fallback, which is the shipped copy.
  const db = seed({ 'email_templates/speaker.reminder': broken });
  const mail = outbox();
  const result = await run(db, IN_7D, mail);
  assert.equal(result.outcome, 'completed');
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].subject, 'Items we still need for Example Event');

  // A deploy that changes the shipped copy is a new version, so the same
  // approval no longer matches and the schedule pauses.
  const edited = { ...getDefaultTemplate('speaker.reminder') };
  edited.text = `${edited.text} `;
  assert.notEqual(wordingVersion(broken, edited), wordingVersion(broken));
});

test('a historical demo refuses the run before anything is written', async () => {
  const db = seed({}, { demo: true });
  const mail = outbox();
  assert.deepEqual(await run(db, IN_7D, mail), { outcome: 'skipped', reason: 'read-only-demo' });
  assert.equal(mail.sent.length, 0);
  assert.deepEqual(db.writes, []);
});

test('an uncertain or failed send is recorded and never sent again in the window', async () => {
  for (const reply of [{ status: 'failed', ambiguous: true }, { status: 'failed' }]) {
    const db = seed();
    const mail = outbox(() => reply);
    const first = await run(db, IN_7D, mail);
    assert.equal(first.uncertain.length + first.failed.length, 1);
    // A day later, after the cooldown, in the same window.
    const later = await run(db, IN_7D + 25 * HOUR, mail);
    assert.equal(later.outcome, 'completed');
    assert.equal(later.recorded, 1);
    assert.equal(mail.sent.length, 1, `${reply.ambiguous ? 'uncertain' : 'failed'} is not sent again`);
    assert.equal(db.read(LEDGER, 'speakers__2026-11-20-7d__ada').outcome, reply.ambiguous ? 'uncertain' : 'failed');
  }
});

test('a staff reminder in the last 24 hours makes the schedule wait; it sends once the cooldown ends', async () => {
  const db = seed({
    [`${REMINDERS}/ada`]: { lastStatus: 'sent', lastBatchId: 'manual-batch-1', lastSentAt: new Date(IN_7D - 2 * HOUR) },
  });
  const mail = outbox();
  const first = await run(db, IN_7D, mail);
  assert.deepEqual(first.waiting, ['ada']);
  assert.equal(mail.sent.length, 0);
  assert.equal(db.read(LEDGER, 'speakers__2026-11-20-7d__ada'), undefined, 'a wait writes no ledger row');
  const later = await run(db, IN_7D + 23 * HOUR, mail);
  assert.deepEqual(later.sent, ['ada']);
  assert.equal(mail.sent.length, 1);
});

test('a scheduled reminder stops a staff reminder for 24 hours', async () => {
  const db = seed();
  await run(db, IN_7D, outbox());
  const staff = await reserve({
    db, speakerId: 'ada', batchId: 'manual-batch-2', items: ['bio'], actor: { uid: 's', email: 'staff@example.test' }, nowMs: IN_7D + HOUR,
  });
  assert.deepEqual(staff, { ok: false, outcome: 'skipped', reason: 'recent' });
  const afterCooldown = await reserve({
    db, speakerId: 'ada', batchId: 'manual-batch-3', items: ['bio'], actor: { uid: 's', email: 'staff@example.test' }, nowMs: IN_7D + REMINDER_COOLDOWN_MS + 1,
  });
  assert.equal(afterCooldown.ok, true);
});

test('a schedule that is off, an ended event, and quiet hours send nothing', async () => {
  const mail = outbox();
  const off = seed({}, { scheduleOverrides: { enabled: false } });
  assert.deepEqual(await run(off, IN_7D, mail), { outcome: 'skipped', reason: 'off' });

  const ended = seed();
  const endedConfig = { ...CONFIG, event: { ...CONFIG.event, days: [{ id: 'day-1', date: '2026-11-01', startTime: '09:00', endTime: '17:00' }] } };
  assert.deepEqual(await run(ended, IN_7D, { ...mail, config: endedConfig }), { outcome: 'skipped', reason: 'event-ended' });
  assert.deepEqual(ended.writes, []);

  // 02:00 in New York, inside the 7-day window.
  const night = seed();
  const result = await run(night, Date.parse('2026-11-15T07:00:00Z'), mail);
  assert.equal(result.outcome, 'nothing-due');
  assert.equal(mail.sent.length, 0);
});

test('saving wording pauses a schedule that is on, unless the version stays the approved one', async () => {
  const db = seed();
  const actor = { uid: 'staff-1', email: 'staff@example.test' };
  assert.equal(await pauseIfWordingChanged({ db, now: () => IN_7D, actor, log: QUIET }), false, 'the shipped wording is the approved one');
  await db.collection('email_templates').doc('speaker.reminder').set({ subject: 'Changed for {{event_name}}' });
  assert.equal(await pauseIfWordingChanged({ db, now: () => IN_7D, actor, log: QUIET }), true);
  assert.equal(db.read(SCHEDULES, 'speakers').pausedReason, 'wording-changed');
  const [row] = logs(db, 'pauseReminderSchedule');
  assert.equal(row.email, 'staff@example.test');
  assert.equal(row.details.by, 'wording-editor');
  // Already paused: nothing more.
  assert.equal(await pauseIfWordingChanged({ db, now: () => IN_7D, actor, log: QUIET }), false);
});

test('the runner runs each branch and a fault in one does not stop the others', async () => {
  const seen = [];
  const results = await runScheduledReminders({ log: QUIET }, [
    { id: 'speakers', run: async () => { throw new Error('boom'); } },
    { id: 'attendees', run: async () => { seen.push('attendees'); return { outcome: 'skipped', reason: 'off' }; } },
  ]);
  assert.deepEqual(results, { speakers: { outcome: 'failed', reason: 'internal' }, attendees: { outcome: 'skipped', reason: 'off' } });
  assert.deepEqual(seen, ['attendees']);
});

test('settings: defaults, limits, and the helpers the run uses', () => {
  const empty = normalizeSpeakerSchedule(null);
  assert.equal(empty.enabled, false);
  assert.deepEqual(empty.offsetsDays, [14, 7, 2]);
  assert.equal(empty.sendTime, '10:00');
  assert.equal(empty.dueAt, null);
  assert.deepEqual(empty.topics, ['bio', 'headshot', 'description', 'materials']);

  const ok = readSpeakerSettings({ offsetsDays: [2, 7, 7, 14], sendTime: '09:30', dueAt: '2026-11-20T17:00:00-05:00', topics: ['materials', 'bio'] });
  assert.deepEqual(ok, { ok: true, value: { offsetsDays: [14, 7, 2], sendTime: '09:30', dueAt: DUE_AT, topics: ['bio', 'materials'] } });
  assert.equal(readSpeakerSettings({ offsetsDays: [7], sendTime: '10:00', dueAt: '', topics: ['bio'] }).value.dueAt, null);
  const bad = readSpeakerSettings({ offsetsDays: [0], sendTime: '25:00', dueAt: '2026-11-20', topics: ['bio', 'nope'] });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 4);
  assert.match(bad.errors.join(' '), /offsetsDays.*sendTime.*dueAt.*topics/);

  assert.equal(batchIdFor('2026-11-20', 7), 'sched-20261120-7d');
  assert.equal(calendarDaysLeft(DUE_AT, ZONE, IN_7D), 7);
  // 23:30 local on the 19th is still one calendar day before the 20th.
  assert.equal(calendarDaysLeft(DUE_AT, ZONE, Date.parse('2026-11-20T04:30:00Z')), 1);
  assert.equal(eventEnded(CONFIG, IN_7D), false);
  assert.equal(eventEnded({ event: { timezone: ZONE } }, IN_7D), false);
});

// Review findings on #528. A run reads the schedule once, then sends one
// speaker at a time; each check below happens again before each speaker.

function twoOwing(extra = {}, options = {}) {
  return seed({
    // Ben now owes a biography too, so the run has two recipients: Ada, Ben.
    'speakers/ben': { firstName: 'Ben', lastName: 'Example', email: 'ben@example.test', status: 'accepted', bio: '', headshotPath: 'b.jpg' },
    ...extra,
  }, options);
}

test('turning the schedule off between two speakers stops the second send', async () => {
  const db = twoOwing();
  const sent = [];
  const sendEmail = async (message) => {
    sent.push(message.to);
    // Staff turn the schedule off while the first message is in flight.
    if (sent.length === 1) await db.collection(SCHEDULES).doc('speakers').set({ enabled: false }, { merge: true });
    return { status: 'sent' };
  };
  const result = await run(db, IN_7D, { sendEmail });
  assert.deepEqual(sent, ['ada@example.test']);
  assert.deepEqual(result.sent, ['ada']);
  assert.equal(result.reason, 'schedule-changed');
  assert.equal(db.read(LEDGER, 'speakers__2026-11-20-7d__ben'), undefined, 'the stopped speaker has no ledger row');
  assert.equal(db.read(REMINDERS, 'ben'), undefined, 'and no reservation');
});

test('a pause, new settings, or a new approval mid-run also stop the next send', async () => {
  for (const change of [
    { pausedReason: 'wording-changed' },
    { sendTime: '11:00' },
    { approvedWordingVersion: 'something-else' },
  ]) {
    const db = twoOwing();
    const sent = [];
    const sendEmail = async (message) => {
      sent.push(message.to);
      if (sent.length === 1) await db.collection(SCHEDULES).doc('speakers').set(change, { merge: true });
      return { status: 'sent' };
    };
    await run(db, IN_7D, { sendEmail });
    assert.deepEqual(sent, ['ada@example.test'], JSON.stringify(change));
  }
});

test('the send loop stops when quiet hours begin, and the rest wait for the next run', async () => {
  const db = twoOwing();
  // 19:59 in New York on the 13th; the clock passes 20:00 after the first send.
  let clock = Date.parse('2026-11-14T00:59:00Z');
  const sent = [];
  const sendEmail = async (message) => {
    sent.push(message.to);
    clock = Date.parse('2026-11-14T01:00:30Z');
    return { status: 'sent' };
  };
  const result = await runSpeakerSchedule({ db, getConfig: async () => CONFIG, sendEmail, now: () => clock, log: QUIET });
  assert.deepEqual(sent, ['ada@example.test']);
  assert.equal(result.reason, 'quiet-hours');
  assert.equal(result.deferred, 1);
  assert.equal(db.read(LEDGER, 'speakers__2026-11-20-7d__ben'), undefined);
  // The next morning, inside the same window, Ben gets his reminder.
  const mail = outbox();
  const morning = await run(db, Date.parse('2026-11-14T14:00:00Z'), mail);
  assert.deepEqual(morning.sent, ['ben']);
});

test('a reservation that throws part way keeps the sends already made in the last run and the admin log', async () => {
  const db = twoOwing();
  const original = db.runTransaction.bind(db);
  let count = 0;
  db.runTransaction = async (fn) => {
    count += 1;
    // 1: the lease. 2: Ada's reservation. 3: Ben's reservation throws.
    if (count === 3) throw new Error('transaction aborted');
    return original(fn);
  };
  const mail = outbox();
  const result = await run(db, IN_7D, mail);
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(result.sent, ['ada']);
  const lastRun = db.read(RUNS, 'speakers').lastRun;
  assert.equal(lastRun.outcome, 'failed');
  assert.equal(lastRun.counts.sent, 1);
  const [row] = logs(db, 'runScheduledReminders');
  assert.deepEqual(row.details.sent, ['ada']);
  assert.equal(row.details.incomplete, true);
});

// Codex review on #532: the hourly run gives each branch one deadline.
test('a run stops before its next speaker at the deadline, and the next run reaches the rest', async () => {
  const db = seed({
    'speakers/dee': { firstName: 'Dee', lastName: 'Example', email: 'dee@example.test', status: 'accepted', bio: '', headshotPath: '' },
  });
  let clock = IN_7D;
  const mail = outbox(() => { clock = IN_7D + 9 * 60_000; return { status: 'sent' }; });
  const first = await runSpeakerSchedule({
    db, getConfig: async () => CONFIG, sendEmail: mail.sendEmail, now: () => clock, log: QUIET, deadlineMs: IN_7D + 8 * 60_000,
  });
  assert.equal(first.reason, 'time-limit');
  assert.deepEqual(first.sent, ['ada']);
  assert.equal(first.deferred, 1);
  assert.equal(db.read(LEDGER, 'speakers__2026-11-20-7d__dee'), undefined);
  const next = await run(db, IN_7D + HOUR, { sendEmail: outbox().sendEmail });
  assert.deepEqual(next.sent, ['dee']);
});

test('a scheduled run uses the same readiness rule: a session that needs no materials asks for none', async () => {
  const complete = { lastName: 'Example', status: 'accepted', bio: 'Bio.', headshotPath: 'speakers/x.jpg' };
  const db = seed({
    'speakers/ben': { ...complete, firstName: 'Ben', email: 'ben@example.test' },
    'speakers/dee': { ...complete, firstName: 'Dee', email: 'dee@example.test' },
    // Ben and Dee share a chat that needs no materials; Dee also gives a talk.
    'cmsSchedule/chat': { title: 'Fireside chat', description: 'Text.', visible: true, speakerIds: ['ben', 'dee'], materialsNotNeeded: true },
    'cmsSchedule/talk': { title: 'Data talk', description: 'Text.', visible: true, speakerIds: ['dee'] },
  }, { scheduleOverrides: { topics: ['materials'] } });
  const mail = outbox();
  const result = await run(db, IN_7D, mail);
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(result.sent, ['dee']);
  assert.equal(mail.sent.length, 1);
  assert.match(mail.sent[0].text, /materials for: Data talk\./);
  assert.doesNotMatch(mail.sent[0].text, /Fireside chat/);
});
