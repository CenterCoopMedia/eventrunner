'use strict';

/**
 * The speaker reminder schedule (issue #518, ADR 0006): its settings, what
 * it would send, and one run of it.
 *
 * `reminder_schedules/speakers` holds the settings. Staff change them only
 * through the `reminderSchedules` endpoint (schedules.cjs). The scheduler
 * (run.cjs) calls runSpeakerSchedule once an hour.
 *
 * WHAT IS DUE is worked out on each run from the settings and the clock by
 * the pure planner (shared/reminderSchedule). The due date (`dueAt`) is the
 * anchor. Each offset is a window. Nothing waits in Firestore for a later
 * run, so this is not a queue.
 *
 * WHO GETS ONE. Every accepted speaker who still owes one of the chosen
 * items (`topics`), by the same rule and code the staff send uses
 * (speakers/reminderCore.cjs). A speaker who finishes drops out.
 *
 * AT MOST ONE PER SPEAKER PER WINDOW. The batch id is fixed for the window
 * (`sched-{due date}-{N}d`), and `reminder_ledger/speakers__{window}__{id}`
 * is created in the same transaction as the `speaker_reminders`
 * reservation. A second run in the same window finds the ledger row and
 * sends nothing. A send that failed or may have gone is recorded too, and
 * no later run sends it again.
 *
 * THE 24-HOUR COOLDOWN applies both ways. A staff send less than 24 hours
 * ago makes the schedule wait: no ledger row is written, so a later run in
 * the same window sends once the cooldown ends. A scheduled send stops a
 * staff send for 24 hours in the same way.
 *
 * APPROVED WORDING ONLY. Staff approve a wording version (reminderCore
 * wordingVersion, the version of the wording actually sent). A run whose
 * wording version differs pauses the schedule, writes an admin_logs row,
 * and tells the operator. It sends nothing until staff approve again.
 */

const { READINESS_ITEMS } = require('shared/speakerReadiness');
const { DEFAULT_OFFSETS, MAX_OFFSET_DAYS, planReminders } = require('shared/reminderSchedule');
const { splitEventDateTime } = require('shared/eventDateTime');
const { readClosesAt: readInstant } = require('shared/pitch');
const { isDayPast } = require('shared/time');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const {
  SKIP_REASONS,
  isoOrNull,
  timestampMs,
  wordingVersion,
  loadReadinessStores,
  cooldownUntil,
  remindableEntries,
  renderReminder,
  sortSelection,
  loadReminderTemplate,
  sendOne,
} = require('../speakers/reminderCore.cjs');

const SCHEDULES = 'reminder_schedules';
const RUNS = 'reminder_schedule_runs';
const LEDGER = 'reminder_ledger';
const SCHEDULE_ID = 'speakers';
const DEFAULT_SEND_TIME = '10:00';
/** Most offsets one schedule may name. */
const MAX_OFFSETS = 6;
/** A run holds the lease this long at most; longer than the function timeout. */
const LEASE_MS = 15 * 60 * 1000;
const DAY_MS = 86_400_000;
const SEND_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Who the scheduler is in admin_logs and on a speaker's reminder record. */
const SCHEDULE_ACTOR = Object.freeze({ uid: null, email: null });

/** Why a schedule is paused, in staff words. */
const PAUSE_REASONS = Object.freeze({
  'wording-changed': 'The reminder wording changed after it was approved. Preview the wording, then approve it again.',
  'settings-changed': 'The schedule settings changed after they were approved. Preview the reminders, then approve them again.',
});

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Offsets as whole days, largest first, without repeats; null when not valid. */
function readOffsets(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_OFFSETS) return null;
  if (!value.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_OFFSET_DAYS)) return null;
  return [...new Set(value)].sort((a, b) => b - a);
}

function readTopics(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((item) => READINESS_ITEMS.includes(item))) return null;
  return READINESS_ITEMS.filter((item) => value.includes(item));
}

/**
 * The stored schedule with every default filled in. Off by default, with
 * offsets of 14, 7 and 2 days at 10:00 on the event's clock (#518).
 */
function normalizeSpeakerSchedule(raw) {
  const data = plainObject(raw);
  return {
    enabled: data.enabled === true,
    offsetsDays: readOffsets(data.offsetsDays) ?? [...DEFAULT_OFFSETS.speakers],
    sendTime: typeof data.sendTime === 'string' && SEND_TIME_RE.test(data.sendTime) ? data.sendTime : DEFAULT_SEND_TIME,
    dueAt: readInstant(data.dueAt),
    topics: readTopics(data.topics) ?? [...READINESS_ITEMS],
    approvedWordingVersion: typeof data.approvedWordingVersion === 'string' ? data.approvedWordingVersion : null,
    approvedAt: isoOrNull(data.approvedAt),
    approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy : null,
    pausedReason: Object.hasOwn(PAUSE_REASONS, data.pausedReason) ? data.pausedReason : null,
    pausedAt: isoOrNull(data.pausedAt),
    updatedAt: isoOrNull(data.updatedAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
  };
}

/** 'off', 'on' or 'paused'. */
function scheduleState(schedule) {
  if (!schedule.enabled) return 'off';
  return schedule.pausedReason ? 'paused' : 'on';
}

/**
 * The settings staff may save. A due date may be left blank while the
 * schedule is off; approve() needs one.
 *
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
function readSpeakerSettings(body) {
  const data = plainObject(body);
  const errors = [];
  const offsetsDays = readOffsets(data.offsetsDays);
  if (!offsetsDays) {
    errors.push(`offsetsDays: Give 1 to ${MAX_OFFSETS} offsets, each a whole number of days from 1 to ${MAX_OFFSET_DAYS}.`);
  }
  const sendTime = typeof data.sendTime === 'string' && SEND_TIME_RE.test(data.sendTime) ? data.sendTime : null;
  if (!sendTime) errors.push('sendTime: Give a time as HH:MM on the event clock.');
  let dueAt = null;
  if (data.dueAt !== null && data.dueAt !== undefined && data.dueAt !== '') {
    dueAt = readInstant(data.dueAt);
    if (!dueAt) errors.push('dueAt: Give a date and time with a time zone offset, or leave it blank.');
  }
  const topics = readTopics(data.topics);
  if (!topics) errors.push(`topics: Choose at least one of ${READINESS_ITEMS.join(', ')}.`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { offsetsDays, sendTime, dueAt, topics } };
}

/** The part of the settings an approval covers, for "did it change". */
function settingsKey(schedule) {
  return JSON.stringify([schedule.offsetsDays, schedule.sendTime, schedule.dueAt, schedule.topics]);
}

function eventTimeZone(config) {
  const zone = config?.event?.timezone;
  return typeof zone === 'string' && zone ? zone : null;
}

/**
 * Whether the event is over: the last configured day's end time has passed
 * on the event's clock. An event with no usable days is not over.
 */
function eventEnded(config, nowMs) {
  const event = config?.event;
  const days = Array.isArray(event?.days) ? event.days.filter((day) => day && typeof day.date === 'string') : [];
  if (days.length === 0) return false;
  const last = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).at(-1);
  if (typeof last.id !== 'string') return false;
  return isDayPast(event, last.id, new Date(nowMs));
}

/** The planner's view of a schedule at `nowMs`. */
function planFor(schedule, timeZone, nowMs) {
  if (!schedule.dueAt) return { ok: false, error: 'dueAt: Set a due date first.' };
  if (!timeZone) return { ok: false, error: 'The event has no time zone. Set it in Event settings.' };
  return planReminders({
    anchor: schedule.dueAt,
    offsetsDays: schedule.offsetsDays,
    sendTime: schedule.sendTime,
    timeZone,
    now: nowMs,
  });
}

/** The fixed batch id of one window: `sched-20261120-7d`. */
function batchIdFor(anchorDate, offsetDays) {
  return `sched-${anchorDate.replace(/-/g, '')}-${offsetDays}d`;
}

function ledgerIdFor(windowKey, speakerId) {
  return `${SCHEDULE_ID}__${windowKey}__${speakerId}`;
}

/** The due date in words on the event's clock, with the zone's short name. */
function formatDue(dueAt, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(dueAt));
}

/** Whole calendar days on the event's clock from `atMs` to the due date. */
function calendarDaysLeft(dueAt, timeZone, atMs) {
  const today = splitEventDateTime(new Date(atMs).toISOString(), timeZone).date;
  const due = splitEventDateTime(dueAt, timeZone).date;
  return Math.max(0, Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS));
}

/** The `due_date` and `days_left` token values at one moment. */
function dueTokens(dueAt, timeZone, atMs) {
  return { dateLabel: formatDue(dueAt, timeZone), daysLeft: calendarDaysLeft(dueAt, timeZone, atMs) };
}

async function loadSchedule(db) {
  const snap = await db.collection(SCHEDULES).doc(SCHEDULE_ID).get();
  return normalizeSpeakerSchedule(snap.exists ? snap.data() : null);
}

/** The speaker ids the ledger holds for one window. */
async function recordedFor(db, windowKey) {
  const snap = await db.collection(LEDGER).where('windowKey', '==', windowKey).get();
  return new Set(snap.docs.map((doc) => doc.data()).filter((row) => row?.scheduleId === SCHEDULE_ID).map((row) => row.speakerId));
}

/**
 * Who a window would reach: every accepted speaker with an address who
 * owes a chosen item and has no ledger row for the window. `waiting` names
 * those still inside the 24-hour cooldown at `atMs`; a later run in the
 * window reaches them. `recorded` counts who owes an item but already has
 * a ledger row for the window.
 */
function audienceFor({ stores, topics, recorded, atMs }) {
  const ids = remindableEntries(stores).map(({ id }) => id);
  const { recipients } = sortSelection({ speakerIds: ids, topics, stores, nowMs: atMs, checkCooldown: false });
  const open = recipients.filter((recipient) => !recorded.has(recipient.speakerId))
    .sort((a, b) => a.name.localeCompare(b.name) || a.speakerId.localeCompare(b.speakerId));
  const done = recipients.length - open.length;
  const waiting = [];
  const ready = [];
  for (const recipient of open) {
    const until = cooldownUntil(stores.reminders.get(recipient.speakerId), atMs);
    if (until) waiting.push({ ...recipient, until: new Date(until).toISOString() });
    else ready.push(recipient);
  }
  return { ready, waiting, recorded: done };
}

/**
 * Pause the schedule, once. The write happens only while the schedule is
 * still on and still holds the approval the caller read, so two callers
 * cannot both log and notify.
 *
 * @returns {Promise<boolean>} whether this call paused it
 */
async function pauseSchedule({ db, reason, expectVersion, nowMs }) {
  const ref = db.collection(SCHEDULES).doc(SCHEDULE_ID);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeSpeakerSchedule(snap.exists ? snap.data() : null);
    if (!current.enabled || current.pausedReason) return false;
    if (expectVersion !== undefined && current.approvedWordingVersion !== expectVersion) return false;
    tx.set(ref, { pausedReason: reason, pausedAt: new Date(nowMs) }, { merge: true });
    return true;
  });
}

/**
 * Pause the schedule when saved or reset wording no longer matches the
 * approval. Called by the wording editor (speakers/reminders.cjs) after it
 * writes. Never throws: the wording is saved, and a run pauses on the same
 * mismatch anyway.
 */
async function pauseIfWordingChanged({ db, now, actor, log = console }) {
  try {
    const schedule = await loadSchedule(db);
    if (scheduleState(schedule) !== 'on') return false;
    const loaded = await loadReminderTemplate(db, now);
    if (wordingVersion(loaded.override) === schedule.approvedWordingVersion) return false;
    const paused = await pauseSchedule({ db, reason: 'wording-changed', expectVersion: schedule.approvedWordingVersion, nowMs: now() });
    if (paused) {
      await logAdminAction({
        db, action: 'pauseReminderSchedule', docPath: `${SCHEDULES}/${SCHEDULE_ID}`, actor, now, log,
        details: { schedule: SCHEDULE_ID, reason: 'wording-changed', by: 'wording-editor' },
      });
    }
    return paused;
  } catch (err) {
    log.warn('reminder schedule pause after a wording change failed', err);
    return false;
  }
}

/** Take the run lease on `reminder_schedule_runs/speakers`, or say why not. */
async function acquireLease({ db, nowMs }) {
  const ref = db.collection(RUNS).doc(SCHEDULE_ID);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const since = timestampMs(snap.exists ? snap.data()?.running?.startedAt : null);
    if (Number.isFinite(since) && nowMs - since < LEASE_MS) return { ok: false, reason: 'busy' };
    tx.set(ref, { running: { startedAt: new Date(nowMs) } }, { merge: true });
    return { ok: true };
  });
}

function ids(rows) {
  return rows.map((row) => row.speakerId);
}

/**
 * Send what is due now, inside the lease. Never called while the schedule
 * is off or paused.
 */
async function sendDue({ db, getConfig, sendEmail, notifyOperator, now, log, schedule }) {
  const config = await getConfig();
  const timeZone = eventTimeZone(config);
  const loaded = await loadReminderTemplate(db, now);
  const version = wordingVersion(loaded.override);
  if (version !== schedule.approvedWordingVersion) {
    const paused = await pauseSchedule({ db, reason: 'wording-changed', expectVersion: schedule.approvedWordingVersion, nowMs: now() });
    if (paused) {
      await logAdminAction({
        db, action: 'pauseReminderSchedule', docPath: `${SCHEDULES}/${SCHEDULE_ID}`, actor: SCHEDULE_ACTOR, now, log,
        details: { schedule: SCHEDULE_ID, reason: 'wording-changed', by: 'scheduler' },
      });
      await notifyOperator({
        kind: 'warning',
        title: 'Scheduled speaker reminders paused',
        summary: 'The speaker reminder wording is not the wording staff approved, so the schedule sent nothing and is paused. '
          + 'Staff preview the reminders and approve them again on the Scheduled reminders page.',
        fields: { schedule: SCHEDULE_ID, reason: 'wording-changed' },
        dedupeKey: `reminder-schedule-paused:${SCHEDULE_ID}`,
      });
    }
    return { outcome: 'paused', reason: 'wording-changed' };
  }
  const plan = planFor(schedule, timeZone, now());
  if (!plan.ok) return { outcome: 'failed', error: { code: 'bad-settings', message: plan.error } };
  if (!plan.due) return { outcome: 'nothing-due' };

  const window = plan.due;
  const batchId = batchIdFor(plan.anchor.date, window.offsetDays);
  const stores = await loadReadinessStores(db);
  const recorded = await recordedFor(db, window.windowKey);
  const startMs = now();
  const audience = audienceFor({ stores, topics: schedule.topics, recorded, atMs: startMs });
  const { ready, waiting } = audience;
  const due = dueTokens(schedule.dueAt, timeZone, startMs);
  // Every message is rendered before the first one goes, so a template or
  // configuration fault stops the run before anyone is emailed.
  const prepared = ready.map((recipient) => ({
    recipient,
    rendered: renderReminder({ ...loaded, config, ...recipient, actor: SCHEDULE_ACTOR, due }),
  }));

  const result = {
    outcome: 'completed',
    windowKey: window.windowKey,
    offsetDays: window.offsetDays,
    batchId,
    sent: [],
    alreadySent: [],
    failed: [],
    uncertain: [],
    waiting: ids(waiting),
    recorded: audience.recorded,
  };
  for (const { recipient, rendered } of prepared) {
    const nowMs = now();
    const also = {
      ref: db.collection(LEDGER).doc(ledgerIdFor(window.windowKey, recipient.speakerId)),
      data: {
        scheduleId: SCHEDULE_ID,
        windowKey: window.windowKey,
        offsetDays: window.offsetDays,
        batchId,
        speakerId: recipient.speakerId,
        items: recipient.items,
        wordingVersion: version,
        createdAt: new Date(nowMs),
      },
    };
    const { outcome, reason } = await sendOne({
      db, sendEmail, log, actor: SCHEDULE_ACTOR, batchId, recipient, rendered, nowMs, also,
    });
    if (outcome === 'sent') result.sent.push(recipient.speakerId);
    else if (outcome === 'already-sent') result.alreadySent.push(recipient.speakerId);
    else if (outcome === 'failed') result.failed.push(recipient.speakerId);
    else if (outcome === 'uncertain') result.uncertain.push(recipient.speakerId);
    else if (reason === 'recorded') result.recorded += 1;
    else result.waiting.push(recipient.speakerId);
    if (['sent', 'failed', 'uncertain'].includes(outcome)) {
      try {
        await also.ref.set({ outcome, finishedAt: new Date(now()) }, { merge: true });
      } catch (err) {
        log.warn('reminder_ledger outcome stamp failed', err);
      }
    }
  }
  return result;
}

/** Whether a run emailed anyone or tried to. */
function reachedAnyone(result) {
  return ['sent', 'failed', 'uncertain'].some((key) => (result[key]?.length ?? 0) > 0);
}

/**
 * One run of the speaker schedule.
 *
 * @param {{ db, getConfig: () => Promise<object>, sendEmail: Function,
 *   notifyOperator: Function, now?: () => number, log?: Console }} deps
 * @returns {Promise<{ outcome: string, reason?: string }>}
 */
async function runSpeakerSchedule({ db, getConfig, sendEmail, notifyOperator = async () => {}, now = Date.now, log = console }) {
  const schedule = await loadSchedule(db);
  if (!schedule.enabled) return { outcome: 'skipped', reason: 'off' };
  if (schedule.pausedReason) return { outcome: 'skipped', reason: 'paused' };
  // A historical demo sends nothing and records nothing.
  const policy = await checkDemoWrites({ db });
  if (!policy.ok) return { outcome: 'skipped', reason: policy.code };
  const config = await getConfig();
  if (eventEnded(config, now())) return { outcome: 'skipped', reason: 'event-ended' };

  const startedMs = now();
  const lease = await acquireLease({ db, nowMs: startedMs });
  if (!lease.ok) return { outcome: 'skipped', reason: lease.reason };

  let result;
  try {
    result = await sendDue({ db, getConfig: async () => config, sendEmail, notifyOperator, now, log, schedule });
  } catch (err) {
    log.error('scheduled speaker reminders failed', err);
    result = {
      outcome: 'failed',
      error: {
        code: err?.code === 'not-ready' ? 'not-ready' : 'internal',
        message: err?.code === 'not-ready' ? err.message : 'The run stopped on a server error. Nothing more was sent.',
      },
    };
  }
  const lastRun = {
    startedAt: new Date(startedMs),
    finishedAt: new Date(now()),
    outcome: result.outcome,
    reason: result.reason ?? null,
    windowKey: result.windowKey ?? null,
    offsetDays: result.offsetDays ?? null,
    batchId: result.batchId ?? null,
    counts: {
      sent: result.sent?.length ?? 0,
      alreadySent: result.alreadySent?.length ?? 0,
      failed: result.failed?.length ?? 0,
      uncertain: result.uncertain?.length ?? 0,
      waiting: result.waiting?.length ?? 0,
      recorded: result.recorded ?? 0,
    },
    error: result.error ?? null,
  };
  try {
    await db.collection(RUNS).doc(SCHEDULE_ID).set({ running: null, lastRun }, { merge: true });
  } catch (err) {
    // The lease runs out on its own.
    log.warn('reminder_schedule_runs stamp failed', err);
  }
  if (reachedAnyone(result)) {
    await logAdminAction({
      db,
      action: 'runScheduledReminders',
      docPath: `${SCHEDULES}/${SCHEDULE_ID}`,
      actor: SCHEDULE_ACTOR,
      now,
      log,
      details: {
        schedule: SCHEDULE_ID,
        windowKey: result.windowKey,
        batchId: result.batchId,
        topics: schedule.topics,
        sent: result.sent,
        alreadySent: result.alreadySent,
        failed: result.failed,
        uncertain: result.uncertain,
        waiting: result.waiting.length,
      },
    });
  }
  return result;
}

module.exports = {
  SCHEDULES,
  RUNS,
  LEDGER,
  SCHEDULE_ID,
  DEFAULT_SEND_TIME,
  MAX_OFFSETS,
  LEASE_MS,
  PAUSE_REASONS,
  SCHEDULE_ACTOR,
  SKIP_REASONS,
  normalizeSpeakerSchedule,
  scheduleState,
  readSpeakerSettings,
  settingsKey,
  eventTimeZone,
  eventEnded,
  planFor,
  batchIdFor,
  ledgerIdFor,
  dueTokens,
  calendarDaysLeft,
  loadSchedule,
  recordedFor,
  audienceFor,
  pauseSchedule,
  pauseIfWordingChanged,
  acquireLease,
  runSpeakerSchedule,
};
