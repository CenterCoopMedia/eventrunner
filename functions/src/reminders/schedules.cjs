'use strict';

/**
 * `reminderSchedules`: the staff endpoint for the reminder schedules
 * (issue #518, ADR 0006). Staff tier, POST, with an `action` and a
 * `schedule`, `speakers` or `attendees`. The speaker actions are below;
 * the attendee actions are in attendeeActions.cjs and work the same way,
 * with a wording draft and the event facts in place of the due date and
 * the items:
 *
 *   get      the settings, on, off or paused, the next run (when, which
 *            offset, who it would reach, who waits on the 24-hour
 *            cooldown) and the last run
 *   save     new settings: offsets, send time, due date, items. Saving a
 *            change while the schedule is on pauses it
 *   preview  one sample message per offset, with the wording version and
 *            the settings version an approval must carry
 *   approve  turn the schedule on for the wording and the settings the
 *            preview showed; refused when either changed since
 *   disable  turn the schedule off
 *
 * `reminder_schedules` is closed to every browser (firestore.rules). This
 * endpoint is the only writer apart from the pauses a run or a wording
 * change makes.
 * Every write checks the historical-demo policy first and writes an
 * admin_logs row.
 */

const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { READINESS_ITEMS } = require('shared/speakerReadiness');
const { DEFAULT_OFFSETS, MAX_OFFSET_DAYS, QUIET_HOURS } = require('shared/reminderSchedule');
const {
  ReminderError,
  fail,
  wordingVersion,
  loadReadinessStores,
  renderReminder,
  loadReminderTemplate,
  requireWritable,
} = require('../speakers/reminderCore.cjs');
const { windowOut, lastRunOut, afterCommit: commitAnswer } = require('./scheduleCore.cjs');
const { ATTENDEE_ACTIONS } = require('./attendeeActions.cjs');
const {
  SCHEDULES,
  RUNS,
  SCHEDULE_ID,
  DEFAULT_SEND_TIME,
  MAX_OFFSETS,
  PAUSE_REASONS,
  normalizeSpeakerSchedule,
  scheduleState,
  readSpeakerSettings,
  settingsKey,
  eventTimeZone,
  eventEnded,
  planFor,
  dueTokens,
  loadSchedule,
  recordedFor,
  audienceFor,
} = require('./speakerSchedule.cjs');

const REQUEST_ACTIONS = Object.freeze(['get', 'save', 'preview', 'approve', 'disable']);
const SCHEDULE_IDS = Object.freeze([SCHEDULE_ID, 'attendees']);
/** Most names the next-run panel lists; the count is always whole. */
const MAX_NAMES = 50;

/** The sample speaker a preview uses when nobody owes anything yet. */
const SAMPLE_SPEAKER = Object.freeze({ firstName: 'Sample', lastName: 'Speaker', email: 'speaker@example.invalid', status: 'accepted' });

function settingsVersion(schedule) {
  return crypto.createHash('sha256').update(settingsKey(schedule), 'utf8').digest('hex').slice(0, 32);
}

function readScheduleId(body) {
  const id = body?.schedule;
  if (!SCHEDULE_IDS.includes(id)) fail(400, 'bad-request', `schedule: Must be one of ${SCHEDULE_IDS.join(', ')}.`);
  return id;
}

function sampleRecipient(topics) {
  const session = [{ id: 'sample-session', title: 'Sample session' }];
  return {
    speakerId: null,
    name: 'Sample Speaker',
    speaker: SAMPLE_SPEAKER,
    readiness: {
      bio: topics.includes('bio'),
      headshot: topics.includes('headshot'),
      descriptionSessions: topics.includes('description') ? session : [],
      materialsSessions: topics.includes('materials') ? session : [],
      missing: [...topics],
    },
    items: [...topics],
    sample: true,
  };
}

function names(rows) {
  return rows.slice(0, MAX_NAMES).map((row) => row.name);
}

/**
 * The next-run panel: when the schedule would next send, which offset, and
 * who it would reach then. Worked out the same way a run works it out.
 */
async function nextRunFor({ db, schedule, timeZone, nowMs }) {
  if (!schedule.dueAt) return { status: 'not-set', message: 'Set a due date to see the next reminder.' };
  const plan = planFor(schedule, timeZone, nowMs);
  if (!plan.ok) return { status: 'invalid', message: plan.error };
  const windows = plan.windows.map(windowOut);
  const upcoming = plan.next
    ? { status: 'upcoming', at: plan.next.at.toISOString(), offsetDays: plan.next.offsetDays, windowKey: plan.next.windowKey, atMs: plan.next.at.getTime() }
    : null;
  const due = plan.due
    ? { status: 'due', at: new Date(nowMs).toISOString(), offsetDays: plan.due.offsetDays, windowKey: plan.due.windowKey, atMs: nowMs }
    : null;
  if (!due && !upcoming) return { status: 'none', message: 'No reminder is left before the due date.', windows };
  const stores = await loadReadinessStores(db);
  const reachAt = async (target) => {
    const recorded = await recordedFor(db, target.windowKey);
    return audienceFor({ stores, topics: schedule.topics, recorded, atMs: target.atMs });
  };
  let target = due ?? upcoming;
  let audience = await reachAt(target);
  // A due window that has reached everyone it can is done: the panel
  // shows the next reminder day instead.
  if (due && audience.ready.length === 0 && audience.waiting.length === 0) {
    // The last window has nothing left to send: the same as no window left.
    if (!upcoming) return { status: 'none', message: 'No reminder is left before the due date.', windows };
    target = upcoming;
    audience = await reachAt(target);
  }
  const { ready, waiting } = audience;
  return {
    status: target.status,
    at: target.at,
    offsetDays: target.offsetDays,
    windowKey: target.windowKey,
    windows,
    reach: {
      count: ready.length,
      names: names(ready),
      waiting: waiting.slice(0, MAX_NAMES).map((row) => ({ name: row.name, until: row.until })),
      waitingCount: waiting.length,
    },
  };
}

/**
 * The answer to a write that has committed (scheduleCore.afterCommit): the
 * schedule read again, or the committed state and `refreshError`.
 */
function afterCommit(deps, committed) {
  return commitAnswer({
    refresh: () => getAction(deps),
    log: deps.log,
    fallback: {
      schedule: SCHEDULE_ID,
      state: scheduleState(committed),
      settings: {
        offsetsDays: committed.offsetsDays,
        sendTime: committed.sendTime,
        dueAt: committed.dueAt,
        topics: committed.topics,
      },
    },
  });
}

// --- actions ---------------------------------------------------------------

async function getAction({ db, getConfig, now }) {
  const nowMs = now();
  const [schedule, config, runSnap, loaded] = await Promise.all([
    loadSchedule(db), getConfig(), db.collection(RUNS).doc(SCHEDULE_ID).get(), loadReminderTemplate(db, now),
  ]);
  const timeZone = eventTimeZone(config);
  const version = wordingVersion(loaded.override);
  return {
    schedule: SCHEDULE_ID,
    state: scheduleState(schedule),
    settings: {
      offsetsDays: schedule.offsetsDays,
      sendTime: schedule.sendTime,
      dueAt: schedule.dueAt,
      topics: schedule.topics,
    },
    approval: {
      wordingVersion: schedule.approvedWordingVersion,
      at: schedule.approvedAt,
      by: schedule.approvedBy,
    },
    paused: schedule.pausedReason
      ? { reason: schedule.pausedReason, message: PAUSE_REASONS[schedule.pausedReason], at: schedule.pausedAt }
      : null,
    updatedAt: schedule.updatedAt,
    updatedBy: schedule.updatedBy,
    wording: {
      version,
      matchesApproval: schedule.approvedWordingVersion !== null && version === schedule.approvedWordingVersion,
    },
    timeZone,
    eventEnded: eventEnded(config, nowMs),
    defaults: { offsetsDays: [...DEFAULT_OFFSETS.speakers], sendTime: DEFAULT_SEND_TIME },
    limits: { maxOffsets: MAX_OFFSETS, maxOffsetDays: MAX_OFFSET_DAYS },
    quietHours: { ...QUIET_HOURS },
    readinessItems: [...READINESS_ITEMS],
    nextRun: await nextRunFor({ db, schedule, timeZone, nowMs }),
    lastRun: lastRunOut(runSnap.exists ? runSnap.data() : null),
  };
}

async function saveAction({ db, getConfig, now, log, actor, body }) {
  const read = readSpeakerSettings(body);
  if (!read.ok) fail(400, 'bad-request', read.errors.join('; '));
  await requireWritable(db);
  const ref = db.collection(SCHEDULES).doc(SCHEDULE_ID);
  const paused = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeSpeakerSchedule(snap.exists ? snap.data() : null);
    const changed = settingsKey(current) !== settingsKey({ ...current, ...read.value });
    // A change to what an approval covers pauses a schedule that is on.
    const pause = changed && scheduleState(current) === 'on';
    tx.set(ref, {
      ...read.value,
      ...(pause ? { pausedReason: 'settings-changed', pausedAt: new Date(now()) } : {}),
      updatedAt: new Date(now()),
      updatedBy: actor.email,
    }, { merge: true });
    return { pause, committed: { ...current, ...read.value, pausedReason: pause ? 'settings-changed' : current.pausedReason } };
  });
  await logAdminAction({
    db, action: 'saveReminderSchedule', docPath: `${SCHEDULES}/${SCHEDULE_ID}`, actor, now, log,
    details: { schedule: SCHEDULE_ID, ...read.value, paused: paused.pause },
  });
  return afterCommit({ db, getConfig, now, log }, paused.committed);
}

async function previewAction({ db, getConfig, now, actor }) {
  const [schedule, config, loaded, stores] = await Promise.all([
    loadSchedule(db), getConfig(), loadReminderTemplate(db, now), loadReadinessStores(db),
  ]);
  const timeZone = eventTimeZone(config);
  const nowMs = now();
  const plan = planFor(schedule, timeZone, nowMs);
  if (!plan.ok) fail(409, 'not-ready', plan.error);
  // Who the reminders would reach if every window were open now, the
  // ledger aside: the first of them is the sample.
  const { ready, waiting } = audienceFor({ stores, topics: schedule.topics, recorded: new Set(), atMs: nowMs });
  const audience = [...ready, ...waiting].sort((a, b) => a.name.localeCompare(b.name));
  const recipient = audience[0] ?? sampleRecipient(schedule.topics);
  let usedFallback = false;
  const samples = plan.windows.map((window) => {
    // The tokens a run would render when the window opens, which is after
    // quiet hours when the send time falls in them.
    const due = dueTokens(schedule.dueAt, timeZone, window.opensAt.getTime());
    const out = renderReminder({ ...loaded, config, ...recipient, actor: { uid: null, email: null }, due });
    usedFallback = usedFallback || out.usedFallback;
    return {
      ...windowOut(window),
      daysLeft: due.daysLeft,
      speakerName: recipient.name,
      sample: recipient.sample === true,
      to: recipient.sample ? null : out.message.to,
      items: recipient.items,
      ...out.delivered,
    };
  });
  return {
    schedule: SCHEDULE_ID,
    wordingVersion: wordingVersion(loaded.override),
    settingsVersion: settingsVersion(schedule),
    usedFallback,
    audienceCount: audience.length,
    samples,
    previewedBy: actor.email,
  };
}

async function approveAction({ db, getConfig, now, log, actor, body }) {
  if (typeof body?.wordingVersion !== 'string' || body.wordingVersion === '') {
    fail(400, 'bad-request', 'wordingVersion: Preview the reminders, then approve.');
  }
  if (typeof body?.settingsVersion !== 'string' || body.settingsVersion === '') {
    fail(400, 'bad-request', 'settingsVersion: Preview the reminders, then approve.');
  }
  await requireWritable(db);
  const [config, loaded] = await Promise.all([getConfig(), loadReminderTemplate(db, now)]);
  const nowMs = now();
  if (eventEnded(config, nowMs)) fail(409, 'event-ended', 'The event has ended. Scheduled reminders cannot be turned on.');
  const version = wordingVersion(loaded.override);
  if (version !== body.wordingVersion) {
    fail(409, 'stale-preview', 'The reminder wording changed after the preview. Preview again, then approve.');
  }
  const timeZone = eventTimeZone(config);
  const ref = db.collection(SCHEDULES).doc(SCHEDULE_ID);
  const approved = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeSpeakerSchedule(snap.exists ? snap.data() : null);
    if (settingsVersion(current) !== body.settingsVersion) {
      fail(409, 'stale-preview', 'The schedule settings changed after the preview. Preview again, then approve.');
    }
    const plan = planFor(current, timeZone, nowMs);
    if (!plan.ok) fail(409, 'not-ready', plan.error);
    if (!plan.windows.some((window) => window.state === 'open' || window.state === 'upcoming')) {
      fail(409, 'not-ready', 'No reminder is left before the due date. Choose a later due date or shorter offsets.');
    }
    tx.set(ref, {
      enabled: true,
      pausedReason: null,
      pausedAt: null,
      approvedWordingVersion: version,
      approvedAt: new Date(nowMs),
      approvedBy: actor.email,
      updatedAt: new Date(nowMs),
      updatedBy: actor.email,
    }, { merge: true });
    return current;
  });
  await logAdminAction({
    db, action: 'approveReminderSchedule', docPath: `${SCHEDULES}/${SCHEDULE_ID}`, actor, now, log,
    details: {
      schedule: SCHEDULE_ID,
      wordingVersion: version,
      offsetsDays: approved.offsetsDays,
      sendTime: approved.sendTime,
      dueAt: approved.dueAt,
      topics: approved.topics,
    },
  });
  return afterCommit({ db, getConfig, now, log }, { ...approved, enabled: true, pausedReason: null });
}

async function disableAction({ db, getConfig, now, log, actor }) {
  await requireWritable(db);
  const current = await loadSchedule(db);
  await db.collection(SCHEDULES).doc(SCHEDULE_ID).set({
    enabled: false,
    pausedReason: null,
    pausedAt: null,
    updatedAt: new Date(now()),
    updatedBy: actor.email,
  }, { merge: true });
  await logAdminAction({
    db, action: 'disableReminderSchedule', docPath: `${SCHEDULES}/${SCHEDULE_ID}`, actor, now, log,
    details: { schedule: SCHEDULE_ID },
  });
  return afterCommit({ db, getConfig, now, log }, { ...current, enabled: false, pausedReason: null });
}

const ACTION_HANDLERS = {
  speakers: {
    get: getAction,
    save: saveAction,
    preview: previewAction,
    approve: approveAction,
    disable: disableAction,
  },
  attendees: ATTENDEE_ACTIONS,
};

/**
 * @param {{ db, auth, getConfig, provider?, now?, log? }} deps `provider`
 *   is the email provider; the attendee schedule checks the announcement
 *   stream through it.
 */
function createReminderSchedulesHandler({ db, auth, getConfig, provider = null, now = Date.now, log = console }) {
  return async function reminderSchedules(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);
    const action = req.body?.action;
    if (!REQUEST_ACTIONS.includes(action)) {
      return badRequest(res, `action: Must be one of ${REQUEST_ACTIONS.join(', ')}.`);
    }
    const actor = { uid: verdict.uid, email: verdict.email };
    try {
      const schedule = readScheduleId(req.body);
      const result = await ACTION_HANDLERS[schedule][action]({ db, getConfig, provider, now, log, actor, body: req.body });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof ReminderError) return sendError(res, err.status, err.code, err.message);
      log.error(`reminderSchedules ${action} failed`, err);
      return internal(res, 'The schedule request could not be completed. Try again.');
    }
  };
}

/**
 * Deployable export: reminderSchedules. It binds the mail provider's
 * secrets, as the announcement endpoints do: the attendee schedule reads
 * the Postmark announcement stream before a preview or an approval.
 */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = (SEND_SECRETS_BY_PROVIDER[(process.env.EVENT_EMAIL_PROVIDER || '').trim()] || []).map(defineSecret);
  return {
    reminderSchedules: onRequest({ region, secrets }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const { getEmailProvider } = require('../email/providers/index.cjs');
      const db = getDb();
      let provider = null;
      try {
        provider = getEmailProvider({ env: process.env });
      } catch (err) {
        // The speaker schedule needs no provider here; the attendee schedule
        // then reports that announcement email cannot be sent.
        console.warn('reminderSchedules: the email provider could not be loaded', err);
      }
      await createReminderSchedulesHandler({ db, auth: getAuth(), getConfig: () => getEventConfig({ db }), provider })(req, res);
    }),
  };
}

module.exports = {
  createReminderSchedulesHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { REQUEST_ACTIONS, SAMPLE_SPEAKER, settingsVersion, nextRunFor, sampleRecipient },
};
