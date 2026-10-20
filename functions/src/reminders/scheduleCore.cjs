'use strict';

/**
 * The parts every reminder schedule shares (issue #518, ADR 0006): the
 * stored settings every schedule has, on, off or paused, the planner call,
 * the pause, the run lease, and one run from start to the admin log.
 *
 * Each schedule (speakerSchedule.cjs, attendeeSchedule.cjs) adds its own
 * settings, its own audience and its own send path. The rules here are the
 * same for both, so they live once:
 *
 *   - A schedule is off by default. It is on only while `enabled` is true
 *     and it has no pause reason.
 *   - A run does nothing while the schedule is off or paused, on a
 *     historical demo, or after the event. It then takes a lease on
 *     `reminder_schedule_runs/{id}`, so two runs never overlap.
 *   - The run stores its last result on the same document and releases the
 *     lease. A run that emailed anyone, or tried to, writes one
 *     `admin_logs` row.
 *   - A pause happens once: only while the schedule is still on and still
 *     holds the approval the caller read, so two callers cannot both log
 *     and notify.
 */

const { MAX_OFFSET_DAYS, planReminders } = require('shared/reminderSchedule');
const { splitEventDateTime } = require('shared/eventDateTime');
const { isDayPast } = require('shared/time');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { isoOrNull, timestampMs } = require('../speakers/reminderCore.cjs');

const SCHEDULES = 'reminder_schedules';
const RUNS = 'reminder_schedule_runs';
const LEDGER = 'reminder_ledger';
const DEFAULT_SEND_TIME = '10:00';
/** Most offsets one schedule may name. */
const MAX_OFFSETS = 6;
/** A run holds the lease this long at most; longer than the function timeout. */
const LEASE_MS = 15 * 60 * 1000;
const DAY_MS = 86_400_000;
const SEND_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Who the scheduler is in admin_logs and on the records it writes. */
const SCHEDULE_ACTOR = Object.freeze({ uid: null, email: null });

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Offsets as whole days, largest first, without repeats; null when not valid. */
function readOffsets(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_OFFSETS) return null;
  if (!value.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_OFFSET_DAYS)) return null;
  return [...new Set(value)].sort((a, b) => b - a);
}

function readSendTime(value) {
  return typeof value === 'string' && SEND_TIME_RE.test(value) ? value : null;
}

const OFFSETS_ERROR = `offsetsDays: Give 1 to ${MAX_OFFSETS} offsets, each a whole number of days from 1 to ${MAX_OFFSET_DAYS}.`;
const SEND_TIME_ERROR = 'sendTime: Give a time as HH:MM on the event clock.';

/**
 * The fields every stored schedule has, with defaults filled in. Off by
 * default.
 *
 * @param {unknown} raw the stored document
 * @param {{ defaultOffsets: readonly number[], pauseReasons: Record<string, string> }} options
 */
function normalizeCommon(raw, { defaultOffsets, pauseReasons }) {
  const data = plainObject(raw);
  return {
    enabled: data.enabled === true,
    offsetsDays: readOffsets(data.offsetsDays) ?? [...defaultOffsets],
    sendTime: readSendTime(data.sendTime) ?? DEFAULT_SEND_TIME,
    approvedWordingVersion: typeof data.approvedWordingVersion === 'string' ? data.approvedWordingVersion : null,
    approvedAt: isoOrNull(data.approvedAt),
    approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy : null,
    pausedReason: Object.hasOwn(pauseReasons, data.pausedReason) ? data.pausedReason : null,
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

/**
 * The planner's view of a schedule at `nowMs`. `anchor` is what the
 * offsets count back from: an instant, or `{ date, time }` on the event
 * clock. `missing` is the message when there is no anchor.
 */
function planAt({ anchor, missing, schedule, timeZone, nowMs }) {
  if (!anchor) return { ok: false, error: missing };
  if (!timeZone) return { ok: false, error: 'The event has no time zone. Set it in Event settings.' };
  return planReminders({
    anchor,
    offsetsDays: schedule.offsetsDays,
    sendTime: schedule.sendTime,
    timeZone,
    now: nowMs,
  });
}

/** Whole calendar days on the event's clock from `atMs` to the local date `date`. */
function calendarDaysUntil(date, timeZone, atMs) {
  const today = splitEventDateTime(new Date(atMs).toISOString(), timeZone).date;
  return Math.max(0, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS));
}

/** One window of a plan, as the endpoint returns it. */
function windowOut(window) {
  return {
    offsetDays: window.offsetDays,
    windowKey: window.windowKey,
    fireAt: window.fireAt.toISOString(),
    opensAt: window.opensAt.toISOString(),
    closesAt: window.closesAt.toISOString(),
    state: window.state,
  };
}

/** The last run as the endpoint returns it. */
function lastRunOut(data) {
  const run = data?.lastRun;
  if (!run || typeof run !== 'object') return null;
  return {
    startedAt: isoOrNull(run.startedAt),
    finishedAt: isoOrNull(run.finishedAt),
    outcome: typeof run.outcome === 'string' ? run.outcome : null,
    reason: typeof run.reason === 'string' ? run.reason : null,
    windowKey: typeof run.windowKey === 'string' ? run.windowKey : null,
    offsetDays: Number.isInteger(run.offsetDays) ? run.offsetDays : null,
    counts: run.counts && typeof run.counts === 'object' ? run.counts : {},
    error: run.error && typeof run.error === 'object' ? { code: run.error.code ?? null, message: run.error.message ?? null } : null,
  };
}

async function loadSchedule(db, id, normalize) {
  const snap = await db.collection(SCHEDULES).doc(id).get();
  return normalize(snap.exists ? snap.data() : null);
}

/**
 * Pause a schedule, once. The write happens only while the schedule is
 * still on and `holds(current)` says it still holds the approval the
 * caller read.
 *
 * @returns {Promise<boolean>} whether this call paused it
 */
async function pauseSchedule({ db, id, normalize, reason, holds = () => true, nowMs }) {
  const ref = db.collection(SCHEDULES).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalize(snap.exists ? snap.data() : null);
    if (!current.enabled || current.pausedReason) return false;
    if (!holds(current)) return false;
    tx.set(ref, { pausedReason: reason, pausedAt: new Date(nowMs) }, { merge: true });
    return true;
  });
}

/**
 * Pause a schedule from a run, write the admin log row and tell the
 * operator, all once. The run then sends nothing.
 */
async function pauseFromRun({ db, id, normalize, reason, holds, now, log, notifyOperator, title, summary }) {
  const paused = await pauseSchedule({ db, id, normalize, reason, holds, nowMs: now() });
  if (paused) {
    await logAdminAction({
      db, action: 'pauseReminderSchedule', docPath: `${SCHEDULES}/${id}`, actor: SCHEDULE_ACTOR, now, log,
      details: { schedule: id, reason, by: 'scheduler' },
    });
    await notifyOperator({
      kind: 'warning',
      title,
      summary,
      fields: { schedule: id, reason },
      dedupeKey: `reminder-schedule-paused:${id}`,
    });
  }
  return { outcome: 'paused', reason };
}

/** Take the run lease on `reminder_schedule_runs/{id}`, or say why not. */
async function acquireLease({ db, id, nowMs }) {
  const ref = db.collection(RUNS).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const since = timestampMs(snap.exists ? snap.data()?.running?.startedAt : null);
    if (Number.isFinite(since) && nowMs - since < LEASE_MS) return { ok: false, reason: 'busy' };
    tx.set(ref, { running: { startedAt: new Date(nowMs) } }, { merge: true });
    return { ok: true };
  });
}

/**
 * One run of one schedule: the checks before it, the lease, the send, the
 * last run, and the admin log.
 *
 * @param {{
 *   id: string,
 *   normalize: (raw: unknown) => object,
 *   sendDue: (deps: object) => Promise<object>,
 *   countsOf: (result: object) => Record<string, number>,
 *   reached: (result: object) => boolean,
 *   logDetails: (result: object, schedule: object) => object,
 *   deps: { db, getConfig: () => Promise<object>, now?: () => number, log?: Console },
 * }} args
 */
async function runSchedule({ id, normalize, sendDue, countsOf, reached, logDetails, deps }) {
  const { db, getConfig, now = Date.now, log = console, notifyOperator = async () => {} } = deps;
  const schedule = await loadSchedule(db, id, normalize);
  if (!schedule.enabled) return { outcome: 'skipped', reason: 'off' };
  if (schedule.pausedReason) return { outcome: 'skipped', reason: 'paused' };
  // A historical demo sends nothing and records nothing.
  const policy = await checkDemoWrites({ db });
  if (!policy.ok) return { outcome: 'skipped', reason: policy.code };
  const config = await getConfig();
  if (eventEnded(config, now())) return { outcome: 'skipped', reason: 'event-ended' };

  const startedMs = now();
  const lease = await acquireLease({ db, id, nowMs: startedMs });
  if (!lease.ok) return { outcome: 'skipped', reason: lease.reason };

  let result;
  try {
    result = await sendDue({ ...deps, getConfig: async () => config, notifyOperator, now, log, schedule });
  } catch (err) {
    log.error(`scheduled ${id} reminders failed`, err);
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
    sendId: result.sendId ?? null,
    counts: countsOf(result),
    error: result.error ?? null,
  };
  try {
    await db.collection(RUNS).doc(id).set({ running: null, lastRun }, { merge: true });
  } catch (err) {
    // The lease runs out on its own.
    log.warn('reminder_schedule_runs stamp failed', err);
  }
  if (reached(result)) {
    await logAdminAction({
      db,
      action: 'runScheduledReminders',
      docPath: `${SCHEDULES}/${id}`,
      actor: SCHEDULE_ACTOR,
      now,
      log,
      details: {
        schedule: id,
        ...logDetails(result, schedule),
        ...(result.reason ? { stoppedFor: result.reason } : {}),
        ...(result.incomplete ? { incomplete: true } : {}),
      },
    });
  }
  return result;
}

/**
 * The answer to a write that has committed. The refresh is a separate read,
 * so it can fail after the change is stored; the request still succeeded.
 * The answer then carries the committed state and `refreshError`, and the
 * page reloads.
 */
async function afterCommit({ refresh, log, fallback }) {
  try {
    return await refresh();
  } catch (err) {
    log.warn('reminderSchedules refresh after a write failed', err);
    return {
      ...fallback,
      refreshError: 'The change is saved, but the schedule could not be read again. Reload the page.',
    };
  }
}

module.exports = {
  SCHEDULES,
  RUNS,
  LEDGER,
  DEFAULT_SEND_TIME,
  MAX_OFFSETS,
  LEASE_MS,
  SEND_TIME_RE,
  SCHEDULE_ACTOR,
  OFFSETS_ERROR,
  SEND_TIME_ERROR,
  plainObject,
  readOffsets,
  readSendTime,
  normalizeCommon,
  scheduleState,
  eventTimeZone,
  eventEnded,
  planAt,
  calendarDaysUntil,
  windowOut,
  lastRunOut,
  loadSchedule,
  pauseSchedule,
  pauseFromRun,
  acquireLease,
  runSchedule,
  afterCommit,
};
