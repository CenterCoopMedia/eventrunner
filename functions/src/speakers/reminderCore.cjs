'use strict';

/**
 * The parts of a speaker reminder that every sender shares: reading the
 * readiness stores, choosing who can be reminded, rendering one message,
 * and the reserve, send and stamp of one speaker (issue #518).
 *
 * The staff endpoint (reminders.cjs) is one caller. The reminder schedule
 * (ADR 0006) is the next one, so both go through the same cooldown, the
 * same send-once claim and the same `speaker_reminders` record. The rules
 * themselves are described in reminders.cjs.
 */

const crypto = require('node:crypto');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { speakerDisplayName } = require('shared/speaker');
const {
  REMINDABLE_SPEAKER_STATUSES,
  sessionsForSpeaker,
  speakerReadiness,
} = require('shared/speakerReadiness');

const SPEAKERS = 'speakers';
const SESSIONS = 'cmsSchedule';
const MATERIALS = 'session_materials';
const REMINDERS = 'speaker_reminders';
const TEMPLATE_ID = 'speaker.reminder';

/** A speaker gets at most one reminder in this window. */
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** A send still marked "sending" after this long is treated as abandoned. */
const SENDING_STALE_MS = 10 * 60 * 1000;
/** The prefix of the wording version when no wording is saved. */
const SHIPPED_WORDING_PREFIX = 'shipped:';

/** Why a chosen speaker gets no reminder, in staff words. */
const SKIP_REASONS = Object.freeze({
  'not-found': 'There is no speaker record with this id.',
  'not-accepted': 'This speaker has not accepted an invitation.',
  'no-email': 'This speaker has no email address.',
  'nothing-missing': 'Nothing in the chosen items is missing.',
  recent: 'This speaker was reminded less than 24 hours ago.',
  'in-progress': 'A reminder to this speaker is being sent now.',
  recorded: 'A reminder for this speaker is already recorded.',
});

class ReminderError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ReminderError(status, code, message);
}

function timestampMs(value) {
  if (value == null) return NaN;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  if (typeof value === 'number') return value;
  return NaN;
}

function isoOrNull(value) {
  const ms = timestampMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function onceKeyFor(speakerId, batchId) {
  return `speaker-reminder:${speakerId}:${batchId}`;
}

function wordingDigest(source) {
  const fields = ['subject', 'html', 'text'].map((key) => (typeof source[key] === 'string' ? source[key] : null));
  return crypto.createHash('sha256').update(JSON.stringify(fields), 'utf8').digest('hex').slice(0, 32);
}

/**
 * Which wording a send uses: a digest of the subject, html and text the
 * renderer will use, or `shipped:` and a digest of the shipped ones. A
 * preview returns it and a send (or an approval and a scheduled run) must
 * match it. The shipped copy has a digest too, so a deploy that changes it
 * is a change of wording, not the same "shipped" (issue #518).
 *
 * The version names the wording ACTUALLY SENT. A saved field left blank
 * takes the shipped field, so the digest covers the shipped field too. A
 * saved wording that fails the template's token check is not sent at all:
 * render() falls back to the shipped copy, so its version is the shipped
 * version. An approval made on that fallback then pauses when a deploy
 * changes the shipped copy, like any other approval of shipped wording.
 *
 * @param {object|null} override the saved wording, or null
 * @param {object} [shipped] the shipped template; the deployed one by default
 */
function wordingVersion(override, shipped = null) {
  const template = shipped ?? require('../email/templates.cjs').getDefaultTemplate(TEMPLATE_ID);
  if (override) {
    const candidate = {};
    for (const key of ['subject', 'html', 'text']) {
      candidate[key] = typeof override[key] === 'string' ? override[key] : template[key];
    }
    const { validateTemplateBody } = require('../email/render.cjs');
    if (validateTemplateBody(template, candidate).ok) return wordingDigest(candidate);
  }
  return `${SHIPPED_WORDING_PREFIX}${wordingDigest(template)}`;
}

function siteUrl(config) {
  return String(config?.tierA?.publicUrl || '').replace(/\/+$/, '');
}

/**
 * The stores the readiness rule reads, once per request.
 *
 * @returns {Promise<{ speakers: Map<string, object>, sessions: object[],
 *   materialsBySession: Record<string, object[]>, reminders: Map<string, object> }>}
 */
async function loadReadinessStores(db) {
  const [speakerSnap, sessionSnap, materialSnap, reminderSnap] = await Promise.all([
    db.collection(SPEAKERS).get(),
    db.collection(SESSIONS).get(),
    db.collection(MATERIALS).select('sessionId', 'reviewStatus').get(),
    db.collection(REMINDERS).get(),
  ]);
  const speakers = new Map(speakerSnap.docs.map((doc) => [doc.id, doc.data()]));
  const sessions = sessionSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  const materialsBySession = {};
  for (const doc of materialSnap.docs) {
    const material = doc.data();
    if (typeof material.sessionId !== 'string') continue;
    (materialsBySession[material.sessionId] ??= []).push(material);
  }
  const reminders = new Map(reminderSnap.docs.map((doc) => [doc.id, doc.data()]));
  return { speakers, sessions, materialsBySession, reminders };
}

function readinessFor(stores, speakerId, speaker) {
  return speakerReadiness({
    speaker,
    sessions: sessionsForSpeaker(stores.sessions, speakerId),
    materialsBySession: stores.materialsBySession,
  });
}

/** The readiness items a speaker would be reminded about, within `topics`. */
function itemsWithin(readiness, topics) {
  return readiness.missing.filter((item) => topics.includes(item));
}

function cooldownUntil(state, nowMs) {
  const last = timestampMs(state?.lastSentAt);
  if (!Number.isFinite(last)) return null;
  const until = last + REMINDER_COOLDOWN_MS;
  return until > nowMs ? until : null;
}

function remindableEntries(stores) {
  return [...stores.speakers.entries()]
    .filter(([, speaker]) => REMINDABLE_SPEAKER_STATUSES.includes(speaker?.status))
    .map(([id, speaker]) => ({ id, speaker }));
}

/**
 * The token values for one speaker's reminder. Every value is plain text:
 * the renderer escapes them in the html body.
 */
function reminderTokenValues({ config, speaker, readiness, items, actor, due = null }) {
  const site = siteUrl(config);
  const wants = (item) => items.includes(item);
  return {
    // Set only by the reminder schedule, which has a due date. Empty for a
    // staff send, so the shipped `{{#if due_date}}` line drops out.
    due_date: due?.dateLabel ?? '',
    days_left: due && Number.isInteger(due.daysLeft) ? String(due.daysLeft) : '',
    speaker_name: speakerDisplayName(speaker),
    dashboard_url: site ? `${site}/speaker/dashboard` : '',
    profile_url: site ? `${site}/speaker/profile` : '',
    admin_contact_email: actor.email || config?.event?.legal?.supportEmail || '',
    needs_bio: wants('bio') && readiness.bio ? 'yes' : '',
    needs_headshot: wants('headshot') && readiness.headshot ? 'yes' : '',
    description_sessions: wants('description')
      ? readiness.descriptionSessions.map((session) => session.title).join('; ')
      : '',
    materials_sessions: wants('materials')
      ? readiness.materialsSessions.map((session) => session.title).join('; ')
      : '',
  };
}

/**
 * Render one reminder: what send() is handed (`message`), and what the
 * provider receives (`delivered`, footer included) for the preview.
 */
function renderReminder({ template, override, config, speaker, readiness, items, actor, due = null }) {
  const { render } = require('../email/render.cjs');
  const { withLegalFooter } = require('../email/send.cjs');
  const tokenValues = reminderTokenValues({ config, speaker, readiness, items, actor, due });
  const rendered = render({ template, override, tokenValues, config });
  const link = tokenValues.dashboard_url;
  if (!link || !(rendered.html || '').includes(link) || !(rendered.text || '').includes(link)) {
    fail(409, 'not-ready', 'The reminder could not be prepared: The event has no public site address for the dashboard link.');
  }
  const delivered = withLegalFooter(rendered, config);
  return {
    message: {
      to: speaker.email.trim(),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: TEMPLATE_ID,
      source: 'speaker-reminder',
      storeRendered: rendered.storeRendered,
      hasLegalFooterHtml: rendered.hasLegalFooterHtml,
      hasLegalFooterText: rendered.hasLegalFooterText,
    },
    delivered: { subject: rendered.subject, html: delivered.html, text: delivered.text },
    usedFallback: rendered.usedFallback,
  };
}

/**
 * Who in a selection can get a reminder now, and why the rest cannot. The
 * cooldown is checked here for the preview and again, transactionally, by
 * send.
 */
function sortSelection({ speakerIds, topics, stores, nowMs, checkCooldown = true }) {
  const recipients = [];
  const skipped = [];
  for (const speakerId of speakerIds) {
    const speaker = stores.speakers.get(speakerId);
    const name = speaker ? speakerDisplayName(speaker) || speakerId : speakerId;
    const skip = (reason) => skipped.push({ speakerId, name, reason, message: SKIP_REASONS[reason] });
    if (!speaker) { skip('not-found'); continue; }
    if (!REMINDABLE_SPEAKER_STATUSES.includes(speaker.status)) { skip('not-accepted'); continue; }
    if (typeof speaker.email !== 'string' || !speaker.email.trim()) { skip('no-email'); continue; }
    const readiness = readinessFor(stores, speakerId, speaker);
    const items = itemsWithin(readiness, topics);
    if (items.length === 0) { skip('nothing-missing'); continue; }
    if (checkCooldown && cooldownUntil(stores.reminders.get(speakerId), nowMs)) { skip('recent'); continue; }
    recipients.push({ speakerId, name, speaker, readiness, items });
  }
  return { recipients, skipped };
}

async function loadReminderTemplate(db, now) {
  const { getDefaultTemplate, loadTemplate } = require('../email/templates.cjs');
  const template = getDefaultTemplate(TEMPLATE_ID);
  // Fresh: the preview must show wording saved a moment ago, and the send
  // must use the wording the preview showed.
  const { override } = await loadTemplate({ db, id: TEMPLATE_ID, now, fresh: true });
  return { template, override };
}

async function requireWritable(db) {
  const policy = await checkDemoWrites({ db });
  if (!policy.ok) fail(policy.status, policy.code, policy.message);
}

/**
 * Reserve one speaker for one batch, or say why not.
 *
 * `also` is an optional `{ ref, data }`: a document to create in the same
 * transaction as the reservation, so the two land together or not at all.
 * When it exists already, nothing is reserved (`recorded`). The schedule's
 * ledger uses it (ADR 0006); the staff endpoint does not.
 *
 * `guard` is an optional `{ ref, check(data) }`: a document read in the
 * same transaction, and a check that returns a reason to stop, or null.
 * A stop reserves and writes nothing (`stopped`). The schedule uses it to
 * read its own settings again before each speaker.
 *
 * @returns {Promise<{ ok: true, sentCount: number } | { ok: false, outcome: string, reason?: string }>}
 */
async function reserve({ db, speakerId, batchId, items, actor, nowMs, also = null, guard = null }) {
  const ref = db.collection(REMINDERS).doc(speakerId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Every read comes before the first write in a transaction.
    const alsoSnap = also ? await tx.get(also.ref) : null;
    if (guard) {
      // The caller's precondition, read in this transaction: when it no
      // longer holds, nothing is reserved or written.
      const guardSnap = await tx.get(guard.ref);
      const stop = guard.check(guardSnap.exists ? guardSnap.data() : null);
      if (stop) return { ok: false, outcome: 'stopped', reason: stop };
    }
    let state = snap.exists ? snap.data() : {};
    const attempt = timestampMs(state.lastAttemptAt);
    if (state.lastStatus === 'sending' && Number.isFinite(attempt) && nowMs - attempt >= SENDING_STALE_MS
      && typeof state.lastBatchId === 'string') {
      // An abandoned send. The email core's claim for its batch says
      // whether the mail may have gone; settle the record by it.
      const { claimIdForOnceKey } = require('../email/send.cjs').internals;
      const claim = await tx.get(db.collection('email_claims').doc(claimIdForOnceKey(onceKeyFor(speakerId, state.lastBatchId))));
      const settled = claim.exists
        ? {
          lastStatus: 'sent',
          lastSentAt: new Date(attempt),
          lastSentBy: state.lastAttemptBy ?? null,
          lastItems: Array.isArray(state.lastAttemptItems) ? state.lastAttemptItems : [],
          sentCount: (Number.isInteger(state.sentCount) ? state.sentCount : 0) + 1,
        }
        : { lastStatus: 'failed' };
      state = { ...state, ...settled };
      tx.set(ref, settled, { merge: true });
    }
    if (alsoSnap?.exists) return { ok: false, outcome: 'skipped', reason: 'recorded' };
    if (state.lastBatchId === batchId) {
      // Replays never send. What the first request did is the answer.
      if (state.lastStatus === 'failed') return { ok: false, outcome: 'failed' };
      if (state.lastStatus === 'uncertain') return { ok: false, outcome: 'uncertain' };
      return { ok: false, outcome: 'already-sent' };
    }
    if (state.lastStatus === 'sending' && Number.isFinite(attempt) && nowMs - attempt < SENDING_STALE_MS) {
      return { ok: false, outcome: 'skipped', reason: 'in-progress' };
    }
    if (cooldownUntil(state, nowMs)) return { ok: false, outcome: 'skipped', reason: 'recent' };
    tx.set(ref, {
      speakerId,
      lastBatchId: batchId,
      lastStatus: 'sending',
      lastAttemptAt: new Date(nowMs),
      lastAttemptBy: actor.email,
      lastAttemptItems: items,
    }, { merge: true });
    if (also) tx.create(also.ref, also.data);
    return { ok: true, sentCount: Number.isInteger(state.sentCount) ? state.sentCount : 0 };
  });
}

/**
 * Reserve, send and stamp one speaker's reminder. `also` and `guard` go to
 * reserve().
 * @returns {Promise<{ outcome: 'sent' | 'already-sent' | 'failed' | 'uncertain' | 'skipped' | 'stopped', reason?: string }>}
 */
async function sendOne({ db, sendEmail, log, actor, batchId, recipient, rendered, nowMs, also = null, guard = null }) {
  const { speakerId, items } = recipient;
  const reservation = await reserve({ db, speakerId, batchId, items, actor, nowMs, also, guard });
  if (!reservation.ok) return reservation;
  let result;
  try {
    result = await sendEmail({ ...rendered.message, onceKey: onceKeyFor(speakerId, batchId) });
  } catch (err) {
    log.error('speaker.reminder send threw', err);
    result = { status: 'failed' };
  }
  // A throw after the request left may still have delivered the mail: it
  // counts as a reminder for the window, so no new batch sends a second one.
  let outcome = 'failed';
  if (result?.status === 'sent') outcome = 'sent';
  else if (result?.ambiguous) outcome = 'uncertain';
  try {
    await db.collection(REMINDERS).doc(speakerId).set(outcome === 'failed'
      ? { lastStatus: 'failed' }
      : {
        lastStatus: outcome,
        lastSentAt: new Date(nowMs),
        lastSentBy: actor.email,
        lastItems: items,
        sentCount: reservation.sentCount + 1,
      }, { merge: true });
  } catch (err) {
    // The record stays at "sending"; reserve() settles it by the claim.
    log.warn('speaker_reminders stamp failed', err);
  }
  return { outcome };
}

module.exports = {
  SPEAKERS,
  REMINDERS,
  TEMPLATE_ID,
  REMINDER_COOLDOWN_MS,
  SENDING_STALE_MS,
  SHIPPED_WORDING_PREFIX,
  SKIP_REASONS,
  ReminderError,
  fail,
  timestampMs,
  isoOrNull,
  onceKeyFor,
  wordingVersion,
  loadReadinessStores,
  readinessFor,
  cooldownUntil,
  remindableEntries,
  reminderTokenValues,
  renderReminder,
  sortSelection,
  loadReminderTemplate,
  requireWritable,
  reserve,
  sendOne,
};
