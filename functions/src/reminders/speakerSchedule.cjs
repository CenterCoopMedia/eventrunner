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
 * EACH SPEAKER IS CHECKED AGAIN. Before each reservation the run stops
 * when quiet hours have begun or the window has closed, and the
 * reservation transaction reads the schedule again: a schedule turned off,
 * paused, re-approved or re-configured since the run began stops the run.
 * The speakers not tried get no ledger row, so a later run reaches them.
 * A fault part way keeps what was already sent in the last run and the
 * admin log.
 *
 * APPROVED WORDING ONLY. Staff approve a wording version (reminderCore
 * wordingVersion, the version of the wording actually sent). A run whose
 * wording version differs pauses the schedule, writes an admin_logs row,
 * and tells the operator. It sends nothing until staff approve again.
 */

const { READINESS_ITEMS } = require('shared/speakerReadiness');
const { DEFAULT_OFFSETS, isQuietAt } = require('shared/reminderSchedule');
const { splitEventDateTime } = require('shared/eventDateTime');
const { readClosesAt: readInstant } = require('shared/pitch');
const { logAdminAction } = require('../cms/store.cjs');
const {
  SKIP_REASONS,
  wordingVersion,
  loadReadinessStores,
  cooldownUntil,
  remindableEntries,
  renderReminder,
  sortSelection,
  loadReminderTemplate,
  sendOne,
} = require('../speakers/reminderCore.cjs');
const core = require('./scheduleCore.cjs');

const {
  SCHEDULES,
  RUNS,
  LEDGER,
  DEFAULT_SEND_TIME,
  MAX_OFFSETS,
  LEASE_MS,
  SCHEDULE_ACTOR,
  plainObject,
  scheduleState,
  eventTimeZone,
  eventEnded,
} = core;
const SCHEDULE_ID = 'speakers';

/** Why a schedule is paused, in staff words. */
const PAUSE_REASONS = Object.freeze({
  'wording-changed': 'The reminder wording changed after it was approved. Preview the wording, then approve it again.',
  'settings-changed': 'The schedule settings changed after they were approved. Preview the reminders, then approve them again.',
});

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
  const common = core.normalizeCommon(data, { defaultOffsets: DEFAULT_OFFSETS.speakers, pauseReasons: PAUSE_REASONS });
  return {
    enabled: common.enabled,
    offsetsDays: common.offsetsDays,
    sendTime: common.sendTime,
    dueAt: readInstant(data.dueAt),
    topics: readTopics(data.topics) ?? [...READINESS_ITEMS],
    approvedWordingVersion: common.approvedWordingVersion,
    approvedAt: common.approvedAt,
    approvedBy: common.approvedBy,
    pausedReason: common.pausedReason,
    pausedAt: common.pausedAt,
    updatedAt: common.updatedAt,
    updatedBy: common.updatedBy,
  };
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
  const offsetsDays = core.readOffsets(data.offsetsDays);
  if (!offsetsDays) errors.push(core.OFFSETS_ERROR);
  const sendTime = core.readSendTime(data.sendTime);
  if (!sendTime) errors.push(core.SEND_TIME_ERROR);
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

/** The planner's view of a schedule at `nowMs`. */
function planFor(schedule, timeZone, nowMs) {
  return core.planAt({ anchor: schedule.dueAt, missing: 'dueAt: Set a due date first.', schedule, timeZone, nowMs });
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
  return core.calendarDaysUntil(splitEventDateTime(dueAt, timeZone).date, timeZone, atMs);
}

/** The `due_date` and `days_left` token values at one moment. */
function dueTokens(dueAt, timeZone, atMs) {
  return { dateLabel: formatDue(dueAt, timeZone), daysLeft: calendarDaysLeft(dueAt, timeZone, atMs) };
}

async function loadSchedule(db) {
  return core.loadSchedule(db, SCHEDULE_ID, normalizeSpeakerSchedule);
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
  return core.pauseSchedule({
    db,
    id: SCHEDULE_ID,
    normalize: normalizeSpeakerSchedule,
    reason,
    holds: (current) => expectVersion === undefined || current.approvedWordingVersion === expectVersion,
    nowMs,
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
function acquireLease({ db, nowMs }) {
  return core.acquireLease({ db, id: SCHEDULE_ID, nowMs });
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
    return core.pauseFromRun({
      db,
      id: SCHEDULE_ID,
      normalize: normalizeSpeakerSchedule,
      reason: 'wording-changed',
      holds: (current) => current.approvedWordingVersion === schedule.approvedWordingVersion,
      now,
      log,
      notifyOperator,
      title: 'Scheduled speaker reminders paused',
      summary: 'The speaker reminder wording is not the wording staff approved, so the schedule sent nothing and is paused. '
        + 'Staff preview the reminders and approve them again on the Scheduled reminders page.',
    });
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
  // Read again in each reservation: a run that staff turn off, pause,
  // re-approve or re-configure part way stops before its next speaker.
  const guard = {
    ref: db.collection(SCHEDULES).doc(SCHEDULE_ID),
    check(data) {
      const live = normalizeSpeakerSchedule(data);
      if (scheduleState(live) !== 'on') return 'schedule-changed';
      if (live.approvedWordingVersion !== schedule.approvedWordingVersion) return 'schedule-changed';
      if (settingsKey(live) !== settingsKey(schedule)) return 'schedule-changed';
      return null;
    },
  };
  let index = 0;
  try {
    for (; index < prepared.length; index += 1) {
      const { recipient, rendered } = prepared[index];
      const nowMs = now();
      // A long run must not send into quiet hours or past its window. The
      // rest get no ledger row, so a later run in the window reaches them.
      if (isQuietAt(new Date(nowMs), timeZone)) {
        result.reason = 'quiet-hours';
        break;
      }
      if (nowMs >= window.closesAt.getTime()) {
        result.reason = 'window-closed';
        break;
      }
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
        db, sendEmail, log, actor: SCHEDULE_ACTOR, batchId, recipient, rendered, nowMs, also, guard,
      });
      if (outcome === 'stopped') {
        result.reason = reason;
        break;
      }
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
  } catch (err) {
    // Keep what was already sent: the last run and the admin log name it.
    log.error('scheduled speaker reminders stopped part way', err);
    result.outcome = 'failed';
    result.incomplete = true;
    result.error = { code: 'internal', message: 'The run stopped on a server error. Reminders sent before it are recorded. Nothing more was sent.' };
  }
  // Who this run did not try: a later run in the window can reach them.
  result.deferred = prepared.length - index;
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
function runSpeakerSchedule(deps) {
  return core.runSchedule({
    id: SCHEDULE_ID,
    normalize: normalizeSpeakerSchedule,
    sendDue,
    reached: reachedAnyone,
    countsOf: (result) => ({
      sent: result.sent?.length ?? 0,
      alreadySent: result.alreadySent?.length ?? 0,
      failed: result.failed?.length ?? 0,
      uncertain: result.uncertain?.length ?? 0,
      waiting: result.waiting?.length ?? 0,
      recorded: result.recorded ?? 0,
      deferred: result.deferred ?? 0,
    }),
    logDetails: (result, schedule) => ({
      windowKey: result.windowKey,
      batchId: result.batchId,
      topics: schedule.topics,
      sent: result.sent,
      alreadySent: result.alreadySent,
      failed: result.failed,
      uncertain: result.uncertain,
      waiting: result.waiting.length,
      deferred: result.deferred ?? 0,
    }),
    deps,
  });
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
