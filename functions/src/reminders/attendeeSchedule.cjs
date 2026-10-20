'use strict';

/**
 * The attendee reminder schedule (issue #518, ADR 0006): "the event is in
 * N days", with the time, the place and the ticket link, before the event
 * starts. Its settings, what it would send, and one run of it.
 *
 * `reminder_schedules/attendees` holds the settings and the staff wording.
 * Staff change them only through the `reminderSchedules` endpoint
 * (attendeeActions.cjs). The scheduler (run.cjs) calls runAttendeeSchedule
 * once an hour. The rules every schedule shares are in scheduleCore.cjs.
 *
 * THE ANCHOR is the start of the first event day, on the event clock. Each
 * offset is a window, worked out on each run by the pure planner. Nothing
 * waits in Firestore for a later run, so this is not a queue.
 *
 * WHO GETS ONE. The announcement audience `registered` (approved attendees
 * and people who claimed a ticket), resolved by announcements/audience.cjs
 * exactly as a staff announcement resolves it: no revoked account, one
 * copy per address, and no address with an unsubscribe record.
 *
 * THE SEND PATH is the announcement send path (announcements/sendRunner.cjs),
 * so a reminder goes on the announcement stream, carries the unsubscribe
 * link and headers of the stream's mode, checks the stream again before
 * each chunk, leaves out an address that unsubscribed since the send
 * began, and shows in the Announcements send history.
 *
 * AT MOST ONE PER ADDRESS PER WINDOW. The send id is fixed for the window
 * (`reminder-attendees-{window}`), and the email core's send-once key is
 * `announcement:{send id}:{address hash}`. The record and the ledger row
 * `reminder_ledger/attendees__{window}` are created in one transaction. A
 * later run in the same window continues the same record, and the claims
 * skip everyone already reached. A failed or uncertain send is never sent
 * again.
 *
 * EACH CHUNK IS CHECKED AGAIN. Before each chunk the run stops when quiet
 * hours have begun or the window has closed, and the lease transaction
 * reads the schedule again: a schedule turned off, paused, re-approved or
 * re-configured since the run began stops the run, and its record is
 * marked `stopped`. A record left part way by quiet hours or by the hourly
 * run's deadline is continued by a later run in the same window. A record
 * whose window closed, that was started on an earlier approval (wording,
 * facts or settings), or whose announcement stream changed part way, is
 * marked `stopped` and is never continued.
 *
 * APPROVED WORDING AND FACTS ONLY. Staff approve a wording version (the
 * draft, or the shipped draft, and the announcement layout) and a facts
 * version (the start, the venue and the ticket link). A run that finds
 * either changed pauses the schedule, writes an admin_logs row, and tells
 * the operator. It sends nothing until staff approve again.
 *
 * THE TICKET LINK goes to `/tickets/mine` when the deployment sells tickets
 * through Stripe (`EVENT_TICKETING_PROVIDER=stripe`, ADR 0004), and to
 * `/dashboard` otherwise (owner decision on #518).
 */

const crypto = require('node:crypto');
const { DEFAULT_OFFSETS, isQuietAt, resolveLocalInstant } = require('shared/reminderSchedule');
const { internals: renderInternals } = require('../email/render.cjs');
const announcementLayout = require('../email/templates/announcement.email.cjs');
const { AudienceError, resolveAudience } = require('../announcements/audience.cjs');
const {
  renderAnnouncement,
  receiptFor,
  resolveChannel,
  senderOf,
  validateDraft,
  internals: composeInternals,
} = require('../announcements/compose.cjs');
const {
  SENDS,
  CHUNK_SIZE,
  EMPTY_COUNTS,
  startSendRecord,
  takeLease,
  markStopped,
  runChunk,
} = require('../announcements/sendRunner.cjs');
const core = require('./scheduleCore.cjs');

const { SCHEDULES, LEDGER, SCHEDULE_ACTOR, plainObject, scheduleState, eventTimeZone } = core;
const { formatVenueAddress } = renderInternals;

const SCHEDULE_ID = 'attendees';
/** The announcement audience the reminder goes to (#518). */
const AUDIENCE = 'registered';
/** The one placeholder staff wording may use. */
const PLACEHOLDER = '{{days_until}}';
const PLACEHOLDER_RE = /\{\{[^{}]*\}\}/g;
/** Room for the days in words: the announcement subject limit is 150. */
const MAX_SUBJECT_LENGTH = 120;
/** Room for the facts block: the announcement message limit is 10,000. */
const MAX_MESSAGE_LENGTH = 5000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The wording a schedule sends until staff save their own. */
const DEFAULT_DRAFT = Object.freeze({
  subject: `Your event is ${PLACEHOLDER} away`,
  message: `The event is ${PLACEHOLDER} away. The details are below. We look forward to seeing you.`,
});

/** Why the schedule is paused, in staff words. */
const PAUSE_REASONS = Object.freeze({
  'wording-changed': 'The attendee reminder wording changed after it was approved. Preview the reminders, then approve them again.',
  'settings-changed': 'The schedule settings changed after they were approved. Preview the reminders, then approve them again.',
  'facts-changed': 'The event start, the venue or the ticket link changed after the reminders were approved. Preview the reminders, then approve them again.',
});

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 32);
}

/** Every `{{…}}` in a text that is not the one placeholder. */
function unknownPlaceholders(text) {
  return [...new Set((text.match(PLACEHOLDER_RE) || []).filter((found) => found !== PLACEHOLDER))];
}

/**
 * The staff wording: a plain text subject and message, with `{{days_until}}`
 * as the only placeholder.
 *
 * @returns {{ ok: true, value: { subject: string, message: string } } | { ok: false, errors: string[] }}
 */
function readDraft(value) {
  const data = plainObject(value);
  if (typeof data.subject !== 'string' && typeof data.message !== 'string') {
    return { ok: false, errors: ['draft: Give a subject and a message.'] };
  }
  const errors = [];
  const subject = typeof data.subject === 'string' ? data.subject.replace(/\s+/g, ' ').trim() : '';
  const message = typeof data.message === 'string' ? data.message.replace(/\r\n?/g, '\n').trim() : '';
  const check = (field, text, max) => {
    if (!text) {
      errors.push(`${field}: Write a ${field}.`);
      return;
    }
    if (text.length > max) errors.push(`${field}: Use ${max} characters or fewer.`);
    const unknown = unknownPlaceholders(text);
    if (unknown.length) errors.push(`${field}: Only ${PLACEHOLDER} can be used. Remove ${unknown.join(', ')}.`);
  };
  check('subject', subject, MAX_SUBJECT_LENGTH);
  check('message', message, MAX_MESSAGE_LENGTH);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { subject, message } };
}

function sameDraft(a, b) {
  return Boolean(a && b) && a.subject === b.subject && a.message === b.message;
}

/**
 * The stored schedule with every default filled in. Off by default, with
 * offsets of 7 and 1 days at 10:00 on the event's clock (#518). A missing
 * or unreadable draft is the shipped draft (null).
 */
function normalizeAttendeeSchedule(raw) {
  const data = plainObject(raw);
  const common = core.normalizeCommon(data, { defaultOffsets: DEFAULT_OFFSETS.attendees, pauseReasons: PAUSE_REASONS });
  const draft = readDraft(data.draft);
  return {
    ...common,
    draft: data.draft && draft.ok ? draft.value : null,
    approvedFactsVersion: typeof data.approvedFactsVersion === 'string' ? data.approvedFactsVersion : null,
  };
}

/**
 * The settings staff may save: the offsets, the send time and the
 * wording.
 *
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
function readAttendeeSettings(body) {
  const data = plainObject(body);
  const errors = [];
  const offsetsDays = core.readOffsets(data.offsetsDays);
  if (!offsetsDays) errors.push(core.OFFSETS_ERROR);
  const sendTime = core.readSendTime(data.sendTime);
  if (!sendTime) errors.push(core.SEND_TIME_ERROR);
  const draft = readDraft(data.draft);
  if (!draft.ok) errors.push(...draft.errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { offsetsDays, sendTime, draft: draft.value } };
}

/** The part of the settings an approval covers, apart from the wording. */
function settingsKey(schedule) {
  return JSON.stringify([schedule.offsetsDays, schedule.sendTime]);
}

function settingsVersion(schedule) {
  return digest(settingsKey(schedule));
}

/**
 * Which wording a send uses: a digest of the staff draft and the
 * announcement layout it is sent in, or `shipped:` and a digest of the
 * shipped draft and the layout. A deploy that changes either shipped part
 * changes the version, so the schedule pauses rather than send wording
 * nobody approved.
 *
 * @param {{ subject: string, message: string }|null} draft
 */
function attendeeWordingVersion(draft) {
  const layout = [announcementLayout.subject, announcementLayout.html, announcementLayout.text];
  if (draft) return digest([draft.subject, draft.message, ...layout]);
  return `shipped:${digest([DEFAULT_DRAFT.subject, DEFAULT_DRAFT.message, ...layout])}`;
}

function siteUrl(config) {
  const url = config?.tierA?.publicUrl;
  return typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
}

/** The start of the first event day, or null. */
function firstDay(event) {
  const days = Array.isArray(event?.days)
    ? event.days.filter((day) => day && DAY_RE.test(day.date ?? '') && TIME_RE.test(day.startTime ?? ''))
    : [];
  if (days.length === 0) return null;
  return [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
}

function formatWhen(instant, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(instant);
}

/**
 * The event facts a reminder states, built by the server from the event
 * settings: when it starts, where, and the ticket link. `version` is what
 * an approval binds.
 *
 * @returns {{ ok: true, version: string, facts: { start: { date: string, time: string, timeZone: string },
 *   when: string, where: string, ticketUrl: string, ticketLabel: string } } | { ok: false, error: string }}
 */
function eventFacts(config) {
  const timeZone = eventTimeZone(config);
  if (!timeZone) return { ok: false, error: 'The event has no time zone. Set it in Event settings.' };
  const day = firstDay(config?.event);
  if (!day) return { ok: false, error: 'The event has no day with a start time. Set the days in Event settings.' };
  const instant = resolveLocalInstant(day.date, day.startTime, timeZone);
  if (!instant) return { ok: false, error: 'The event start could not be read. Check the days in Event settings.' };
  const site = siteUrl(config);
  if (!site) return { ok: false, error: 'The site has no public address, so the reminder cannot link to the ticket page.' };
  const stripe = (config?.tierA?.ticketingProvider || '').trim() === 'stripe';
  const venue = plainObject(config?.event?.venue);
  const where = [typeof venue.name === 'string' ? venue.name.trim() : '', formatVenueAddress(venue)]
    .filter(Boolean)
    .join(', ');
  const facts = {
    start: { date: day.date, time: day.startTime, timeZone },
    when: formatWhen(instant, timeZone),
    where,
    ticketUrl: `${site}${stripe ? '/tickets/mine' : '/dashboard'}`,
    ticketLabel: stripe ? 'View your tickets' : 'Open your dashboard',
  };
  return {
    ok: true,
    version: digest([facts.start.date, facts.start.time, timeZone, facts.where, facts.ticketUrl, facts.ticketLabel]),
    facts,
  };
}

/** "7 days", "1 day", or "less than a day" on the event's first day. */
function daysUntilWords(days) {
  if (days <= 0) return 'less than a day';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The facts block the server adds after the staff message. */
function factsBlock(facts) {
  return [`When: ${facts.when}`, facts.where ? `Where: ${facts.where}` : null].filter(Boolean).join('\n');
}

/**
 * The announcement draft one reminder sends: the staff wording with the
 * days filled in, the facts block, and the ticket link as the button.
 *
 * @returns {{ ok: boolean, errors: string[], value: object }} validateDraft's answer
 */
function composeReminder({ draft, facts, daysUntil }) {
  const words = daysUntilWords(daysUntil);
  const fill = (text) => text.split(PLACEHOLDER).join(words);
  return validateDraft({
    subject: fill(draft.subject),
    message: `${fill(draft.message)}\n\n${factsBlock(facts)}`,
    linkUrl: facts.ticketUrl,
    linkLabel: facts.ticketLabel,
  });
}

/** The planner's view of the schedule at `nowMs`. */
function planFor(schedule, facts, timeZone, nowMs) {
  return core.planAt({
    anchor: facts.ok ? { date: facts.facts.start.date, time: facts.facts.start.time } : null,
    missing: facts.ok ? null : facts.error,
    schedule,
    timeZone,
    nowMs,
  });
}

/** The fixed send id of one window: `reminder-attendees-2026-12-01-7d`. */
function sendIdFor(windowKey) {
  return `reminder-${SCHEDULE_ID}-${windowKey}`;
}

function ledgerIdFor(windowKey) {
  return `${SCHEDULE_ID}__${windowKey}`;
}

async function loadSchedule(db) {
  return core.loadSchedule(db, SCHEDULE_ID, normalizeAttendeeSchedule);
}

/**
 * The guard read in each record and lease transaction: the run stops when
 * the live schedule is no longer the one it started with.
 */
function guardFor(db, schedule) {
  return {
    ref: db.collection(SCHEDULES).doc(SCHEDULE_ID),
    check(data) {
      const live = normalizeAttendeeSchedule(data);
      if (scheduleState(live) !== 'on') return 'schedule-changed';
      if (live.approvedWordingVersion !== schedule.approvedWordingVersion) return 'schedule-changed';
      if (live.approvedFactsVersion !== schedule.approvedFactsVersion) return 'schedule-changed';
      if (attendeeWordingVersion(live.draft) !== attendeeWordingVersion(schedule.draft)) return 'schedule-changed';
      if (settingsKey(live) !== settingsKey(schedule)) return 'schedule-changed';
      return null;
    },
  };
}

function holdsApproval(schedule) {
  return (current) => current.approvedWordingVersion === schedule.approvedWordingVersion
    && current.approvedFactsVersion === schedule.approvedFactsVersion;
}

function countsBetween(before, after) {
  const out = { ...EMPTY_COUNTS };
  for (const key of Object.keys(out)) out[key] = Math.max(0, (after?.[key] ?? 0) - (before?.[key] ?? 0));
  return out;
}

/** Mark the records of windows that have closed as stopped. */
async function stopClosedWindows({ db, plan, nowMs }) {
  for (const window of plan.windows) {
    if (window.state !== 'closed') continue;
    await markStopped({ db, sendId: sendIdFor(window.windowKey), nowMs, reason: 'window-closed' });
  }
}

/**
 * Create the window's record and ledger row, or say why not. The audience
 * is resolved and the email rendered now, once, for the whole window.
 */
async function startWindow({ db, config, channel, schedule, facts, window, version, guard, nowMs }) {
  let recipients;
  try {
    ({ recipients } = await resolveAudience({ db, audience: AUDIENCE }));
  } catch (err) {
    if (err instanceof AudienceError) return { error: { code: err.code, message: err.message } };
    throw err;
  }
  if (recipients.length === 0) return { nobody: true };
  const timeZone = eventTimeZone(config);
  const daysUntil = core.calendarDaysUntil(facts.facts.start.date, timeZone, nowMs);
  const draft = composeReminder({ draft: schedule.draft ?? DEFAULT_DRAFT, facts: facts.facts, daysUntil });
  if (!draft.ok) {
    return { error: { code: 'not-ready', message: `The reminder could not be prepared: ${draft.errors.join('; ')}` } };
  }
  const rendered = renderAnnouncement({ config, draft: draft.value, mode: channel.mode });
  const sendId = sendIdFor(window.windowKey);
  const receipt = receiptFor({
    audience: `${AUDIENCE}:reminder:${window.windowKey}`, recipients, rendered, sender: senderOf(config), channel,
  });
  const started = await startSendRecord({
    db,
    sendId,
    nowMs,
    audience: AUDIENCE,
    draft: draft.value,
    rendered,
    channel,
    receipt,
    recipients,
    createdBy: SCHEDULE_ACTOR,
    extra: {
      reminder: {
        schedule: SCHEDULE_ID,
        windowKey: window.windowKey,
        offsetDays: window.offsetDays,
        wordingVersion: version,
        factsVersion: facts.version,
        settingsVersion: settingsVersion(schedule),
      },
    },
    guard,
    also: {
      ref: db.collection(LEDGER).doc(ledgerIdFor(window.windowKey)),
      data: {
        scheduleId: SCHEDULE_ID,
        windowKey: window.windowKey,
        offsetDays: window.offsetDays,
        sendId,
        total: recipients.length,
        wordingVersion: version,
        factsVersion: facts.version,
        createdAt: new Date(nowMs),
      },
    },
  });
  if (started.stopped) return { stopped: started.stopped, total: recipients.length };
  return { started: true };
}

/**
 * Send what is due now, inside the lease. Never called while the schedule
 * is off or paused.
 */
/** True for a refusal of the announcement channel, not of one message. */
function isChannelRefusal(code) {
  return code === 'channel-changed' || Object.hasOwn(composeInternals.CHANNEL_MESSAGES, code);
}

/**
 * Tell the operator that a send could not go on because of the channel.
 * The same notice key as the check before a send, so one fault is one
 * notice.
 */
async function tellChannelFault({ notifyOperator, code, message, stopped }) {
  await notifyOperator({
    kind: 'warning',
    title: 'Scheduled attendee reminders cannot send',
    summary: stopped
      ? `The announcement stream or its unsubscribe handling changed while an attendee reminder was being sent, so the rest of that reminder day's send is stopped and will not be sent. ${message}`
      : `An attendee reminder send could not go on: ${message} The next hourly run tries again.`,
    fields: { schedule: SCHEDULE_ID, reason: code },
    dedupeKey: `reminder-schedule-channel:${SCHEDULE_ID}`,
  });
}

async function sendDue({ db, getConfig, provider, emailCore, notifyOperator, now, log, schedule, deadlineMs = null }) {
  const config = await getConfig();
  const timeZone = eventTimeZone(config);
  const version = attendeeWordingVersion(schedule.draft);
  if (version !== schedule.approvedWordingVersion) {
    return core.pauseFromRun({
      db,
      id: SCHEDULE_ID,
      normalize: normalizeAttendeeSchedule,
      reason: 'wording-changed',
      holds: holdsApproval(schedule),
      now,
      log,
      notifyOperator,
      title: 'Scheduled attendee reminders paused',
      summary: 'The attendee reminder wording is not the wording staff approved, so the schedule sent nothing and is paused. '
        + 'Staff preview the reminders and approve them again on the Scheduled reminders page.',
    });
  }
  const facts = eventFacts(config);
  // Approval needs facts that can be read, so facts that cannot be read
  // now have changed too.
  if (!facts.ok || facts.version !== schedule.approvedFactsVersion) {
    return core.pauseFromRun({
      db,
      id: SCHEDULE_ID,
      normalize: normalizeAttendeeSchedule,
      reason: 'facts-changed',
      holds: holdsApproval(schedule),
      now,
      log,
      notifyOperator,
      title: 'Scheduled attendee reminders paused',
      summary: 'The event start, the venue or the ticket link changed after staff approved the attendee reminders, so the schedule '
        + 'sent nothing and is paused. Staff preview the reminders and approve them again on the Scheduled reminders page.',
    });
  }
  const plan = planFor(schedule, facts, timeZone, now());
  if (!plan.ok) return { outcome: 'failed', error: { code: 'bad-settings', message: plan.error } };
  await stopClosedWindows({ db, plan, nowMs: now() });
  if (!plan.due) return { outcome: 'nothing-due' };

  const window = plan.due;
  const sendId = sendIdFor(window.windowKey);
  const base = { windowKey: window.windowKey, offsetDays: window.offsetDays, sendId };
  // The stream is checked before any record or claim, as a staff send does.
  const channel = await resolveChannel({ provider, config });
  if (!channel.ok) {
    await notifyOperator({
      kind: 'warning',
      title: 'Scheduled attendee reminders cannot send',
      summary: `The attendee reminder is due, but announcement email cannot be sent: ${channel.message}`,
      fields: { schedule: SCHEDULE_ID, reason: channel.code },
      dedupeKey: `reminder-schedule-channel:${SCHEDULE_ID}`,
    });
    return { outcome: 'failed', ...base, error: { code: channel.code, message: channel.message } };
  }

  const guard = guardFor(db, schedule);
  const ref = db.collection(SENDS).doc(sendId);
  let snap = await ref.get();
  if (!snap.exists) {
    const started = await startWindow({ db, config, channel, schedule, facts, window, version, guard, nowMs: now() });
    if (started.nobody) return { outcome: 'completed', ...base, counts: { ...EMPTY_COUNTS }, total: 0, deferred: 0 };
    if (started.error) return { outcome: 'failed', ...base, error: started.error };
    if (started.stopped) {
      return { outcome: 'completed', ...base, reason: started.stopped, counts: { ...EMPTY_COUNTS }, total: started.total, deferred: started.total };
    }
    snap = await ref.get();
    if (!snap.exists) {
      // The ledger names this window but the record is missing: never send
      // without the record, whose claims stop a second copy.
      return { outcome: 'failed', ...base, error: { code: 'internal', message: 'The reminder record for this day is missing. Nothing was sent.' } };
    }
  }
  const record = snap.data();
  if (record.reminder?.wordingVersion !== schedule.approvedWordingVersion
    || record.reminder?.factsVersion !== schedule.approvedFactsVersion
    || record.reminder?.settingsVersion !== settingsVersion(schedule)) {
    // Started on an earlier approval (other wording, facts or settings):
    // never continued on what nobody approved now, and never sent twice.
    const stopped = await markStopped({ db, sendId, nowMs: now(), reason: 'superseded' });
    return {
      outcome: 'completed',
      ...base,
      ...(stopped ? { reason: 'superseded' } : {}),
      counts: { ...EMPTY_COUNTS },
      total: record.total ?? 0,
      deferred: 0,
    };
  }

  const result = { outcome: 'completed', ...base, counts: { ...EMPTY_COUNTS }, total: record.total ?? 0 };
  const before = { ...EMPTY_COUNTS, ...(record.counts || {}) };
  let last = record;
  // One chunk more than the record can need, so a lost lease cannot loop.
  const maxChunks = Math.ceil((record.total ?? 0) / CHUNK_SIZE) + 1;
  try {
    for (let chunk = 0; chunk < maxChunks && last.status === 'sending'; chunk += 1) {
      const nowMs = now();
      // The hourly run's deadline (run.cjs): a later run sends the rest.
      if (deadlineMs !== null && nowMs >= deadlineMs) {
        result.reason = 'time-limit';
        break;
      }
      // A long run must not send into quiet hours or past its window.
      if (isQuietAt(new Date(nowMs), timeZone)) {
        result.reason = 'quiet-hours';
        break;
      }
      if (nowMs >= window.closesAt.getTime()) {
        result.reason = 'window-closed';
        await markStopped({ db, sendId, nowMs, reason: 'window-closed' });
        break;
      }
      const lease = await takeLease({ db, sendId, nowMs, guard });
      if (lease.missing) break;
      if (lease.done) {
        last = lease.data;
        break;
      }
      if (lease.stopped) {
        // Turned off, paused or changed: this record is never continued.
        result.reason = lease.stopped;
        await markStopped({ db, sendId, nowMs, reason: lease.stopped });
        break;
      }
      if (lease.busy) {
        result.reason = 'busy';
        break;
      }
      const finished = await runChunk({ db, sendId, lease, getConfig, provider, emailCore, now, log });
      if (finished.error) {
        const [, code, message] = finished.error;
        result.outcome = 'failed';
        result.error = { code, message };
        if (isChannelRefusal(code)) {
          // A changed stream or mode can never continue this record: its
          // bodies and unsubscribe links were made for the old one. Any
          // other channel refusal may pass, so the record waits.
          const stopped = code === 'channel-changed'
            && await markStopped({ db, sendId, nowMs: now(), reason: 'channel-changed' });
          await tellChannelFault({ notifyOperator, code, message, stopped });
        }
        break;
      }
      last = finished.data ?? last;
      if (finished.stale) {
        result.reason = 'busy';
        break;
      }
    }
  } catch (err) {
    // Keep what was already sent: the record, the last run and the admin
    // log name it.
    log.error('scheduled attendee reminders stopped part way', err);
    result.outcome = 'failed';
    result.incomplete = true;
    result.error = { code: 'internal', message: 'The run stopped on a server error. Reminders sent before it are recorded. Nothing more was sent.' };
  }
  result.counts = countsBetween(before, last.counts);
  result.processed = last.nextIndex ?? 0;
  result.deferred = Math.max(0, (last.total ?? 0) - (last.nextIndex ?? 0));
  return result;
}

/** Whether a run emailed anyone or tried to. */
function reachedAnyone(result) {
  const counts = result.counts ?? {};
  return (counts.sent ?? 0) + (counts.failed ?? 0) + (counts.uncertain ?? 0) > 0;
}

/**
 * One run of the attendee schedule.
 *
 * @param {{ db, getConfig: () => Promise<object>, provider: object,
 *   emailCore: { sendBatch: Function }, notifyOperator?: Function,
 *   now?: () => number, log?: Console }} deps
 * @returns {Promise<{ outcome: string, reason?: string }>}
 */
function runAttendeeSchedule(deps) {
  return core.runSchedule({
    id: SCHEDULE_ID,
    normalize: normalizeAttendeeSchedule,
    sendDue,
    reached: reachedAnyone,
    countsOf: (result) => ({
      ...EMPTY_COUNTS,
      ...(result.counts ?? {}),
      total: result.total ?? 0,
      deferred: result.deferred ?? 0,
    }),
    // Counts only: the send record holds the addresses, as a staff send's does.
    logDetails: (result) => ({
      windowKey: result.windowKey,
      sendId: result.sendId,
      counts: result.counts,
      total: result.total ?? 0,
      deferred: result.deferred ?? 0,
    }),
    deps,
  });
}

module.exports = {
  SCHEDULE_ID,
  AUDIENCE,
  PLACEHOLDER,
  DEFAULT_DRAFT,
  PAUSE_REASONS,
  MAX_SUBJECT_LENGTH,
  MAX_MESSAGE_LENGTH,
  readDraft,
  sameDraft,
  normalizeAttendeeSchedule,
  readAttendeeSettings,
  settingsKey,
  settingsVersion,
  attendeeWordingVersion,
  eventFacts,
  daysUntilWords,
  composeReminder,
  planFor,
  sendIdFor,
  ledgerIdFor,
  loadSchedule,
  runAttendeeSchedule,
};
