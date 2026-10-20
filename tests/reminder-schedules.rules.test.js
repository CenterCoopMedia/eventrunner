// Scheduled speaker and attendee reminders (issue #518, ADR 0006) against
// the real Firestore emulator: browsers are denied the three schedule
// collections, a full run done twice sends one reminder per speaker and one
// per attendee, the ledger row lands with the reservation or the send
// record, saving new wording through the staff wording editor pauses the
// speaker schedule, and an unsubscribe from a scheduled attendee reminder
// records a suppression that the next reminder honours. Authentication and
// the mail provider are the only fakes; the email core is the real one, so
// its send-once claims are real documents.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const { createReminderSchedulesHandler } = require('../functions/src/reminders/schedules.cjs');
const { runScheduledReminders } = require('../functions/src/reminders/run.cjs');
const { createSpeakerRemindersHandler } = require('../functions/src/speakers/reminders.cjs');
const { createEmailCore } = require('../functions/src/email/send.cjs');
const { createConsoleProvider } = require('../functions/src/email/providers/console.cjs');
const { createEmailUnsubscribeHandler, suppressionIdFor } = require('../functions/src/announcements/suppression.cjs');
const { resetTemplateCacheForTest } = require('../functions/src/email/templates.cjs');

const PROJECT_ID = 'demo-run-of-show';
const STAFF_EMAIL = 'schedule-staff@example.test';
const QUIET = { error() {}, warn() {}, info() {} };
// Before every window: the settings are saved and approved here.
const SETUP = Date.parse('2026-11-01T15:00:00Z');
// Inside the 7-day window of a due date of 2026-11-20 17:00 New York time.
const IN_7D = Date.parse('2026-11-13T15:30:00Z');
// Inside the 7-day and the 1-day windows before the event starts, at
// 2026-12-01 09:00 New York time.
const ATTENDEE_7D = Date.parse('2026-11-24T15:30:00Z');
const ATTENDEE_1D = Date.parse('2026-11-30T15:30:00Z');
const HOUR = 3_600_000;

const CONFIG = {
  event: {
    name: 'Example Event',
    timezone: 'America/New_York',
    sender: { email: 'events@example.test', name: 'Example Event' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.test' },
    days: [{ id: 'day-1', date: '2026-12-01', startTime: '09:00', endTime: '17:00' }],
    venue: { name: 'Example Hall', city: 'Example City' },
    social: { handles: [] },
  },
  theme: { colors: {} },
  tierA: { publicUrl: 'https://site.example.test', ticketingProvider: 'manual' },
  providers: { email: { provider: 'console', messageStream: null, announcementStream: 'announcements' } },
};

const auth = {
  async verifyIdToken(token) {
    if (token !== 'staff') throw new Error('invalid token');
    return { uid: 'staff-1', email: STAFF_EMAIL, email_verified: true };
  },
};

let testEnv;
let adminApp;
let db;
let outbox;
let operatorEvents;
let announcementMail;

const provider = {
  name: 'capture',
  async send(message) {
    outbox.push(message);
    return { providerMessageId: `m-${outbox.length}`, status: 'sent' };
  },
};

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    set() { return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

// The real console provider: announcement batches land in announcementMail.
const announcementProvider = createConsoleProvider({
  env: { FUNCTIONS_EMULATOR: 'true', E2E_MAIL_FILE: '/tmp/unused' },
  log: { log() {} },
  appendFileSync: (_file, line) => announcementMail.push(JSON.parse(line)),
});

const getConfig = async () => CONFIG;

async function schedules(body, now = SETUP) {
  const res = makeRes();
  await createReminderSchedulesHandler({ db, auth, getConfig, provider: announcementProvider, now: () => now, log: QUIET })(
    { method: 'POST', headers: { authorization: 'Bearer staff' }, body: { schedule: 'speakers', ...body } },
    res,
  );
  return res;
}

async function wording(body, now = SETUP) {
  const res = makeRes();
  await createSpeakerRemindersHandler({ db, auth, getConfig, now: () => now, log: QUIET })(
    { method: 'POST', headers: { authorization: 'Bearer staff' }, body },
    res,
  );
  return res;
}

function runAt(now) {
  const core = createEmailCore({ db, provider, getConfig, sleep: async () => {}, log: QUIET });
  const announcementCore = createEmailCore({ db, provider: announcementProvider, getConfig, sleep: async () => {}, log: QUIET });
  return runScheduledReminders({
    db,
    getConfig,
    sendEmail: core.send,
    provider: announcementProvider,
    emailCore: announcementCore,
    notifyOperator: async (event) => { operatorEvents.push(event); },
    now: () => now,
    log: QUIET,
  });
}

async function approveAttendees() {
  const saved = await schedules({
    schedule: 'attendees',
    action: 'save',
    offsetsDays: [7, 1],
    sendTime: '10:00',
    draft: { subject: 'See you in {{days_until}}', message: 'Doors open soon.' },
  });
  expect(saved.statusCode).toBe(200);
  const preview = await schedules({ schedule: 'attendees', action: 'preview' });
  expect(preview.statusCode).toBe(200);
  const approved = await schedules({
    schedule: 'attendees',
    action: 'approve',
    wordingVersion: preview.body.wordingVersion,
    settingsVersion: preview.body.settingsVersion,
    factsVersion: preview.body.factsVersion,
  });
  expect(approved.statusCode).toBe(200);
  expect(approved.body.state).toBe('on');
}

async function unsubscribe(query) {
  const res = makeRes();
  res.send = (payload) => { res.body = payload; return res; };
  await createEmailUnsubscribeHandler({ db, getConfig, log: QUIET })(
    { method: 'POST', headers: {}, query, body: {} },
    res,
  );
  return res;
}

async function approve() {
  const saved = await schedules({ action: 'save', offsetsDays: [14, 7, 2], sendTime: '10:00', dueAt: '2026-11-20T17:00:00-05:00', topics: ['bio', 'headshot'] });
  expect(saved.statusCode).toBe(200);
  const preview = await schedules({ action: 'preview' });
  expect(preview.statusCode).toBe(200);
  const approved = await schedules({
    action: 'approve', wordingVersion: preview.body.wordingVersion, settingsVersion: preview.body.settingsVersion,
  });
  expect(approved.statusCode).toBe(200);
  expect(approved.body.state).toBe('on');
}

async function adminLogs(action) {
  const snap = await db.collection('admin_logs').where('action', '==', action).get();
  return snap.docs.map((d) => d.data());
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: PROJECT_ID }, `reminder-schedules-${process.pid}`);
  db = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  resetTemplateCacheForTest();
  outbox = [];
  operatorEvents = [];
  announcementMail = [];
  await db.collection('config').doc('bootstrap').set({ adminEmails: [], staffEmails: [STAFF_EMAIL] });
  await db.collection('config').doc('event').set({ name: 'Example Event', historicalDemo: false });
  await db.collection('speakers').doc('ada').set({ firstName: 'Ada', lastName: 'Lee', email: 'ada@example.test', status: 'accepted', bio: '', headshotPath: '' });
  await db.collection('speakers').doc('ben').set({ firstName: 'Ben', lastName: 'Ode', email: 'ben@example.test', status: 'approved', bio: 'Bio.', headshotPath: '' });
  // Owes nothing in the chosen items.
  await db.collection('speakers').doc('cy').set({ firstName: 'Cy', lastName: 'Done', email: 'cy@example.test', status: 'accepted', bio: 'Bio.', headshotPath: 'c.png' });
  // Registered attendees, and one account that has not registered.
  await db.collection('users').doc('u-ada').set({ email: 'ada@example.test', registrationStatus: 'approved' });
  await db.collection('users').doc('u-ben').set({ email: 'ben@example.test', registrationStatus: 'ticketed' });
  await db.collection('users').doc('u-cy').set({ email: 'cy@example.test', registrationStatus: 'pending' });
});

afterAll(async () => {
  await testEnv?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

describe('rules', () => {
  it('denies every browser the schedule, the runs and the ledger, staff included', async () => {
    await approve();
    await runAt(IN_7D);
    const staff = testEnv.authenticatedContext('staff-1', { email: STAFF_EMAIL, email_verified: true }).firestore();
    const anon = testEnv.unauthenticatedContext().firestore();
    await approveAttendees();
    await runAt(ATTENDEE_7D);
    for (const path of [
      'reminder_schedules/speakers', 'reminder_schedule_runs/speakers', 'reminder_ledger/speakers__2026-11-20-7d__ada',
      'reminder_schedules/attendees', 'reminder_schedule_runs/attendees', 'reminder_ledger/attendees__2026-12-01-7d',
      'announcement_sends/reminder-attendees-2026-12-01-7d',
    ]) {
      await assertFails(getDoc(doc(staff, path)));
      await assertFails(getDoc(doc(anon, path)));
      await assertFails(setDoc(doc(staff, path), { enabled: true }));
    }
  });
});

describe('a full run', () => {
  it('done twice in one window sends one reminder to each speaker who owes an item', async () => {
    await approve();
    const first = await runAt(IN_7D);
    expect(first.speakers.outcome).toBe('completed');
    expect([...first.speakers.sent].sort()).toEqual(['ada', 'ben']);
    expect(outbox.map((m) => m.to).sort()).toEqual(['ada@example.test', 'ben@example.test']);
    expect(outbox[0].text).toMatch(/Please send them by Friday, November 20, 2026/);

    const second = await runAt(IN_7D + HOUR);
    expect(second.speakers.sent).toEqual([]);
    expect(second.speakers.recorded).toBe(2);
    expect(outbox).toHaveLength(2);

    const ledger = await db.collection('reminder_ledger').get();
    expect(ledger.docs.map((d) => d.id).sort()).toEqual(['speakers__2026-11-20-7d__ada', 'speakers__2026-11-20-7d__ben']);
    const ada = (await db.collection('speaker_reminders').doc('ada').get()).data();
    expect(ada.lastBatchId).toBe('sched-20261120-7d');
    expect(ada.lastStatus).toBe('sent');
    // One send-once claim per speaker for the window's batch.
    const claims = await db.collection('email_claims').get();
    expect(claims.size).toBe(2);
    // One admin_logs row, for the run that reached someone.
    expect(await adminLogs('runScheduledReminders')).toHaveLength(1);
    const run = (await db.collection('reminder_schedule_runs').doc('speakers').get()).data();
    expect(run.running).toBeNull();
    expect(run.lastRun.outcome).toBe('completed');
  });

  it('shows the next run and the last run to staff through the endpoint', async () => {
    await approve();
    const before = await schedules({ action: 'get' });
    expect(before.body.nextRun.status).toBe('upcoming');
    expect(before.body.nextRun.offsetDays).toBe(14);
    expect(before.body.nextRun.reach.names).toEqual(['Ada Lee', 'Ben Ode']);
    await runAt(IN_7D);
    const after = await schedules({ action: 'get' }, IN_7D + HOUR);
    expect(after.body.lastRun.outcome).toBe('completed');
    expect(after.body.lastRun.counts.sent).toBe(2);
    // The 7-day window reached everyone, so the panel shows the 2-day one.
    expect(after.body.nextRun.status).toBe('upcoming');
    expect(after.body.nextRun.offsetDays).toBe(2);
  });
});

describe('wording', () => {
  it('saving new wording pauses the schedule, and a run then sends nothing', async () => {
    await approve();
    const saved = await wording({ action: 'saveTemplate', subject: 'Still needed for {{event_name}}' });
    expect(saved.statusCode).toBe(200);
    const state = await schedules({ action: 'get' });
    expect(state.body.state).toBe('paused');
    expect(state.body.paused.reason).toBe('wording-changed');
    expect(await adminLogs('pauseReminderSchedule')).toHaveLength(1);
    const run = await runAt(IN_7D);
    expect(run.speakers).toEqual({ outcome: 'skipped', reason: 'paused' });
    expect(outbox).toHaveLength(0);
  });

  it('a run that finds unapproved wording pauses the schedule and tells the operator', async () => {
    await approve();
    // Written around the endpoint, as a deploy that changes the copy would.
    await db.collection('email_templates').doc('speaker.reminder').set({ subject: 'Changed for {{event_name}}' });
    const run = await runAt(IN_7D);
    expect(run.speakers).toEqual({ outcome: 'paused', reason: 'wording-changed' });
    expect(outbox).toHaveLength(0);
    expect(operatorEvents).toHaveLength(1);
    expect((await db.collection('reminder_schedules').doc('speakers').get()).data().pausedReason).toBe('wording-changed');
  });
});

describe('attendees', () => {
  it('a full run done twice in one window sends one reminder to each registered attendee', async () => {
    await approveAttendees();
    const first = await runAt(ATTENDEE_7D);
    expect(first.attendees.outcome).toBe('completed');
    expect(first.attendees.counts.sent).toBe(2);
    expect(announcementMail.map((m) => m.to).sort()).toEqual(['ada@example.test', 'ben@example.test']);
    expect(announcementMail[0].subject).toBe('See you in 7 days');
    expect(announcementMail[0].messageStream).toBe('announcements');
    expect(announcementMail[0].text).toMatch(/Open your dashboard: https:\/\/site\.example\.test\/dashboard/);

    const second = await runAt(ATTENDEE_7D + HOUR);
    expect(second.attendees.counts.sent).toBe(0);
    expect(announcementMail).toHaveLength(2);

    const record = (await db.collection('announcement_sends').doc('reminder-attendees-2026-12-01-7d').get()).data();
    expect(record.status).toBe('sent');
    expect(record.reminder.windowKey).toBe('2026-12-01-7d');
    const ledger = await db.collection('reminder_ledger').doc('attendees__2026-12-01-7d').get();
    expect(ledger.data().sendId).toBe('reminder-attendees-2026-12-01-7d');
    const claims = await db.collection('email_claims').where('source', '==', 'announcement').get();
    expect(claims.size).toBe(2);
    const rows = (await adminLogs('runScheduledReminders')).filter((row) => row.details.schedule === 'attendees');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/@/);
  });

  it('an unsubscribe from a scheduled reminder records a suppression, and the next reminder leaves the address out', async () => {
    await approveAttendees();
    await runAt(ATTENDEE_7D);
    const ada = announcementMail.find((m) => m.to === 'ada@example.test');
    const link = new URL(ada.headers['List-Unsubscribe'].slice(1, -1));
    const res = await unsubscribe(Object.fromEntries(link.searchParams));
    expect(res.statusCode).toBe(200);
    const suppression = await db.collection('email_suppressions').doc(suppressionIdFor('ada@example.test')).get();
    expect(suppression.exists).toBe(true);
    expect(suppression.data().sendId).toBe('reminder-attendees-2026-12-01-7d');

    const next = await runAt(ATTENDEE_1D);
    expect(next.attendees.counts.sent).toBe(1);
    expect(announcementMail.slice(2).map((m) => m.to)).toEqual(['ben@example.test']);
  });

  it('a change to the event start pauses the schedule before anything is sent', async () => {
    await approveAttendees();
    const moved = { ...CONFIG, event: { ...CONFIG.event, days: [{ id: 'day-1', date: '2026-12-02', startTime: '09:00', endTime: '17:00' }] } };
    const announcementCore = createEmailCore({ db, provider: announcementProvider, getConfig: async () => moved, sleep: async () => {}, log: QUIET });
    const result = await runScheduledReminders({
      db,
      getConfig: async () => moved,
      sendEmail: async () => ({ status: 'failed' }),
      provider: announcementProvider,
      emailCore: announcementCore,
      notifyOperator: async (event) => { operatorEvents.push(event); },
      now: () => ATTENDEE_7D,
      log: QUIET,
    });
    expect(result.attendees).toEqual({ outcome: 'paused', reason: 'facts-changed' });
    expect(announcementMail).toHaveLength(0);
    expect(operatorEvents).toHaveLength(1);
    expect((await db.collection('reminder_schedules').doc('attendees').get()).data().pausedReason).toBe('facts-changed');
  });
});
