'use strict';

/**
 * The `reminderSchedules` actions for the attendee schedule (issue #518,
 * ADR 0006). schedules.cjs checks the caller and the request, then hands a
 * request with `schedule: 'attendees'` here:
 *
 *   get      the settings and the wording, on, off or paused, the facts the
 *            server builds (start, venue, ticket link), whether announcement
 *            email can be sent, the next run (when, which offset, how many
 *            it would reach) and the last run
 *   save     new offsets, send time and wording. A change while the
 *            schedule is on pauses it
 *   preview  one sample message per offset, rendered as the run renders it,
 *            with the wording, settings and facts versions an approval
 *            must carry
 *   approve  turn the schedule on for the wording, settings and facts the
 *            preview showed; refused when any changed since, or when
 *            announcement email cannot be sent
 *   disable  turn the schedule off
 *
 * The next-run panel gives counts only. Attendee addresses never leave the
 * server through this endpoint.
 */

const { DEFAULT_OFFSETS, MAX_OFFSET_DAYS, QUIET_HOURS } = require('shared/reminderSchedule');
const { logAdminAction } = require('../cms/store.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { AudienceError, resolveAudience } = require('../announcements/audience.cjs');
const { SENDS } = require('../announcements/sendRunner.cjs');
const {
  previewBodies,
  renderAnnouncement,
  resolveChannel,
  senderOf,
  unsubscribeNote,
} = require('../announcements/compose.cjs');
const { fail, requireWritable } = require('../speakers/reminderCore.cjs');
const core = require('./scheduleCore.cjs');
const {
  SCHEDULE_ID,
  AUDIENCE,
  PLACEHOLDER,
  DEFAULT_DRAFT,
  PAUSE_REASONS,
  MAX_SUBJECT_LENGTH,
  MAX_MESSAGE_LENGTH,
  sameDraft,
  normalizeAttendeeSchedule,
  readAttendeeSettings,
  settingsKey,
  settingsVersion,
  attendeeWordingVersion,
  eventFacts,
  composeReminder,
  planFor,
  sendIdFor,
  loadSchedule,
} = require('./attendeeSchedule.cjs');

const { SCHEDULES, RUNS, DEFAULT_SEND_TIME, MAX_OFFSETS, scheduleState, eventTimeZone, eventEnded } = core;

function settingsOut(schedule) {
  return {
    offsetsDays: schedule.offsetsDays,
    sendTime: schedule.sendTime,
    draft: schedule.draft ?? { ...DEFAULT_DRAFT },
  };
}

function factsOut(facts, schedule) {
  if (!facts.ok) return { ok: false, problem: facts.error, matchesApproval: false };
  return {
    ok: true,
    version: facts.version,
    when: facts.facts.when,
    where: facts.facts.where,
    ticketUrl: facts.facts.ticketUrl,
    ticketLabel: facts.facts.ticketLabel,
    matchesApproval: schedule.approvedFactsVersion !== null && facts.version === schedule.approvedFactsVersion,
  };
}

/** Whether announcement email can be sent now, and why not. */
async function channelState({ db, provider, config }) {
  const policy = await checkDemoWrites({ db });
  if (!policy.ok) return { canSend: false, blocker: policy.message, mode: null, stream: null };
  const channel = await resolveChannel({ provider, config });
  return channel.ok
    ? { canSend: true, blocker: null, mode: channel.mode, stream: channel.stream }
    : { canSend: false, blocker: channel.message, mode: null, stream: null };
}

/** How many the reminder would reach now: counts only. */
async function reachNow(db) {
  try {
    const { recipients, suppressed, unusable } = await resolveAudience({ db, audience: AUDIENCE });
    return { count: recipients.length, suppressed, unusable };
  } catch (err) {
    if (err instanceof AudienceError) return { count: null, problem: err.message };
    throw err;
  }
}

/**
 * The next-run panel: when the schedule would next send, which offset, and
 * how many it would reach then. A due window whose send has finished is
 * done, and the panel shows the next one.
 */
async function nextRunFor({ db, schedule, facts, timeZone, nowMs }) {
  if (!facts.ok) return { status: 'invalid', message: facts.error };
  const plan = planFor(schedule, facts, timeZone, nowMs);
  if (!plan.ok) return { status: 'invalid', message: plan.error };
  const windows = plan.windows.map(core.windowOut);
  const none = { status: 'none', message: 'No reminder is left before the event starts.', windows };
  let target = null;
  if (plan.due) {
    const record = await db.collection(SENDS).doc(sendIdFor(plan.due.windowKey)).get();
    const finished = record.exists && record.data()?.status !== 'sending';
    if (!finished) target = { status: 'due', at: new Date(nowMs).toISOString(), offsetDays: plan.due.offsetDays, windowKey: plan.due.windowKey };
  }
  if (!target && plan.next) {
    target = { status: 'upcoming', at: plan.next.at.toISOString(), offsetDays: plan.next.offsetDays, windowKey: plan.next.windowKey };
  }
  if (!target) return none;
  return { ...target, windows, reach: await reachNow(db) };
}

async function getAction({ db, getConfig, provider, now }) {
  const nowMs = now();
  const [schedule, config, runSnap] = await Promise.all([
    loadSchedule(db), getConfig(), db.collection(RUNS).doc(SCHEDULE_ID).get(),
  ]);
  const timeZone = eventTimeZone(config);
  const facts = eventFacts(config);
  const version = attendeeWordingVersion(schedule.draft);
  const { stream: _stream, ...channel } = await channelState({ db, provider, config });
  return {
    schedule: SCHEDULE_ID,
    state: scheduleState(schedule),
    settings: settingsOut(schedule),
    approval: {
      wordingVersion: schedule.approvedWordingVersion,
      factsVersion: schedule.approvedFactsVersion,
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
      shipped: schedule.draft === null,
      matchesApproval: schedule.approvedWordingVersion !== null && version === schedule.approvedWordingVersion,
    },
    facts: factsOut(facts, schedule),
    channel,
    timeZone,
    eventEnded: eventEnded(config, nowMs),
    defaults: { offsetsDays: [...DEFAULT_OFFSETS.attendees], sendTime: DEFAULT_SEND_TIME, draft: { ...DEFAULT_DRAFT } },
    limits: {
      maxOffsets: MAX_OFFSETS,
      maxOffsetDays: MAX_OFFSET_DAYS,
      maxSubjectLength: MAX_SUBJECT_LENGTH,
      maxMessageLength: MAX_MESSAGE_LENGTH,
    },
    placeholder: PLACEHOLDER,
    quietHours: { ...QUIET_HOURS },
    nextRun: await nextRunFor({ db, schedule, facts, timeZone, nowMs }),
    lastRun: core.lastRunOut(runSnap.exists ? runSnap.data() : null),
  };
}

function afterCommit(deps, committed) {
  return core.afterCommit({
    refresh: () => getAction(deps),
    log: deps.log,
    fallback: { schedule: SCHEDULE_ID, state: scheduleState(committed), settings: settingsOut(committed) },
  });
}

async function saveAction({ db, getConfig, provider, now, log, actor, body }) {
  const read = readAttendeeSettings(body);
  if (!read.ok) fail(400, 'bad-request', read.errors.join('; '));
  await requireWritable(db);
  // The shipped wording, saved unchanged, stays the shipped wording.
  const value = { ...read.value, draft: sameDraft(read.value.draft, DEFAULT_DRAFT) ? null : read.value.draft };
  const ref = db.collection(SCHEDULES).doc(SCHEDULE_ID);
  const saved = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeAttendeeSchedule(snap.exists ? snap.data() : null);
    const next = { ...current, ...value };
    let reason = null;
    if (scheduleState(current) === 'on') {
      // A change to what an approval covers pauses a schedule that is on.
      if (attendeeWordingVersion(current.draft) !== attendeeWordingVersion(next.draft)) reason = 'wording-changed';
      else if (settingsKey(current) !== settingsKey(next)) reason = 'settings-changed';
    }
    tx.set(ref, {
      ...value,
      ...(reason ? { pausedReason: reason, pausedAt: new Date(now()) } : {}),
      updatedAt: new Date(now()),
      updatedBy: actor.email,
    }, { merge: true });
    return { reason, committed: { ...next, pausedReason: reason ?? current.pausedReason } };
  });
  await logAdminAction({
    db, action: 'saveReminderSchedule', docPath: `${SCHEDULES}/${SCHEDULE_ID}`, actor, now, log,
    details: {
      schedule: SCHEDULE_ID,
      offsetsDays: value.offsetsDays,
      sendTime: value.sendTime,
      wordingVersion: attendeeWordingVersion(value.draft),
      paused: saved.reason !== null,
    },
  });
  return afterCommit({ db, getConfig, provider, now, log }, saved.committed);
}

async function previewAction({ db, getConfig, provider, now, actor }) {
  const [schedule, config] = await Promise.all([loadSchedule(db), getConfig()]);
  const timeZone = eventTimeZone(config);
  const nowMs = now();
  const facts = eventFacts(config);
  if (!facts.ok) fail(409, 'not-ready', facts.error);
  const plan = planFor(schedule, facts, timeZone, nowMs);
  if (!plan.ok) fail(409, 'not-ready', plan.error);
  const channel = await channelState({ db, provider, config });
  const { count, suppressed, unusable, problem } = await reachNow(db);
  const draft = schedule.draft ?? DEFAULT_DRAFT;
  const samples = plan.windows.map((window) => {
    // The days a run would render when the window opens, which is after
    // quiet hours when the send time falls in them.
    const daysUntil = core.calendarDaysUntil(facts.facts.start.date, timeZone, window.opensAt.getTime());
    const composed = composeReminder({ draft, facts: facts.facts, daysUntil });
    if (!composed.ok) fail(409, 'not-ready', `The reminder could not be prepared: ${composed.errors.join('; ')}`);
    const rendered = renderAnnouncement({ config, draft: composed.value, mode: channel.mode ?? 'app' });
    const shown = previewBodies({ rendered, config });
    return { ...core.windowOut(window), daysUntil, subject: rendered.subject, html: shown.html, text: shown.text };
  });
  const sender = senderOf(config);
  let blocker = channel.blocker;
  if (!blocker && problem) blocker = problem;
  return {
    schedule: SCHEDULE_ID,
    wordingVersion: attendeeWordingVersion(schedule.draft),
    settingsVersion: settingsVersion(schedule),
    factsVersion: facts.version,
    recipientCount: count,
    suppressedCount: suppressed ?? 0,
    unusableCount: unusable ?? 0,
    from: sender.from,
    replyTo: sender.replyTo,
    stream: channel.stream,
    unsubscribeNote: unsubscribeNote(channel.mode ?? 'app'),
    canSend: blocker === null,
    blocker,
    samples,
    previewedBy: actor.email,
  };
}

async function approveAction({ db, getConfig, provider, now, log, actor, body }) {
  for (const key of ['wordingVersion', 'settingsVersion', 'factsVersion']) {
    if (typeof body?.[key] !== 'string' || body[key] === '') fail(400, 'bad-request', `${key}: Preview the reminders, then approve.`);
  }
  await requireWritable(db);
  const config = await getConfig();
  const nowMs = now();
  if (eventEnded(config, nowMs)) fail(409, 'event-ended', 'The event has ended. Scheduled reminders cannot be turned on.');
  const facts = eventFacts(config);
  if (!facts.ok) fail(409, 'not-ready', facts.error);
  if (facts.version !== body.factsVersion) {
    fail(409, 'stale-preview', 'The event start, the venue or the ticket link changed after the preview. Preview again, then approve.');
  }
  const channel = await resolveChannel({ provider, config });
  if (!channel.ok) fail(409, channel.code, channel.message);
  const timeZone = eventTimeZone(config);
  const ref = db.collection(SCHEDULES).doc(SCHEDULE_ID);
  const approved = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeAttendeeSchedule(snap.exists ? snap.data() : null);
    if (settingsVersion(current) !== body.settingsVersion) {
      fail(409, 'stale-preview', 'The schedule settings changed after the preview. Preview again, then approve.');
    }
    const version = attendeeWordingVersion(current.draft);
    if (version !== body.wordingVersion) {
      fail(409, 'stale-preview', 'The reminder wording changed after the preview. Preview again, then approve.');
    }
    const plan = planFor(current, facts, timeZone, nowMs);
    if (!plan.ok) fail(409, 'not-ready', plan.error);
    if (!plan.windows.some((window) => window.state === 'open' || window.state === 'upcoming')) {
      fail(409, 'not-ready', 'No reminder is left before the event starts. Choose shorter offsets.');
    }
    tx.set(ref, {
      enabled: true,
      pausedReason: null,
      pausedAt: null,
      approvedWordingVersion: version,
      approvedFactsVersion: facts.version,
      approvedAt: new Date(nowMs),
      approvedBy: actor.email,
      updatedAt: new Date(nowMs),
      updatedBy: actor.email,
    }, { merge: true });
    return { ...current, version };
  });
  await logAdminAction({
    db, action: 'approveReminderSchedule', docPath: `${SCHEDULES}/${SCHEDULE_ID}`, actor, now, log,
    details: {
      schedule: SCHEDULE_ID,
      wordingVersion: approved.version,
      factsVersion: facts.version,
      offsetsDays: approved.offsetsDays,
      sendTime: approved.sendTime,
    },
  });
  return afterCommit({ db, getConfig, provider, now, log }, { ...approved, enabled: true, pausedReason: null });
}

async function disableAction({ db, getConfig, provider, now, log, actor }) {
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
  return afterCommit({ db, getConfig, provider, now, log }, { ...current, enabled: false, pausedReason: null });
}

const ATTENDEE_ACTIONS = Object.freeze({
  get: getAction,
  save: saveAction,
  preview: previewAction,
  approve: approveAction,
  disable: disableAction,
});

module.exports = { ATTENDEE_ACTIONS, internals: { nextRunFor, channelState } };
