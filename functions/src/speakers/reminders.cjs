'use strict';

/**
 * Speaker reminders: staff email accepted speakers about what they still
 * owe the event (biography, headshot, session description, materials).
 *
 * One admin endpoint, `speakerReminders`, staff tier, with an `action`:
 *
 *   list           every accepted speaker with what they still owe, when
 *                  they were last reminded, and whether they can be
 *                  reminded now
 *   preview        the exact subject, html and text each chosen speaker
 *                  would get, footer included, plus who is left out and why
 *   send           the same messages, sent; needs the recipient count the
 *                  preview showed (`confirmCount`) and a `batchId`
 *   export         the readiness list as CSV for the organizer's own mail
 *                  tool (issue #332); written to admin_logs before it leaves
 *   template       the shipped and the saved reminder wording
 *   saveTemplate   save new wording, checked against the template's tokens
 *   resetTemplate  delete the saved wording; the shipped copy applies again
 *
 * WHAT IS MISSING comes from shared/speakerReadiness, the same rule the
 * speaker's own "Your next steps" list uses, read here from the canonical
 * stores (speakers, the live cmsSchedule documents, session_materials).
 *
 * ONE REMINDER PER CLICK. Each send carries a client-made `batchId`, one per
 * preview. `speaker_reminders/{speakerId}` (server-only) records the batch
 * that last reached the speaker, inside a transaction, BEFORE the mail goes.
 * A second request with the same batch (a double click, a retry after a lost
 * response) finds the batch there and sends nothing. The email core's
 * send-once claim (`speaker-reminder:{speakerId}:{batchId}`) is the second
 * barrier. A different batch inside REMINDER_COOLDOWN_MS of a sent reminder
 * is refused for that speaker: this is a control on the speaker's inbox, the
 * same reasoning as the invite send budget in invites.cjs.
 *
 * Historical demos refuse every write here (send, saveTemplate,
 * resetTemplate) before anything is stored; core/demoWrites.cjs.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction, isValidDocId } = require('../cms/store.cjs');
const { speakerDisplayName } = require('shared/speaker');
const {
  READINESS_ITEMS,
  READINESS_ITEM_LABELS,
  REMINDABLE_SPEAKER_STATUSES,
  sessionsForSpeaker,
  speakerReadiness,
  normalizeReadinessTopics,
} = require('shared/speakerReadiness');

const SPEAKERS = 'speakers';
const SESSIONS = 'cmsSchedule';
const MATERIALS = 'session_materials';
const REMINDERS = 'speaker_reminders';
const TEMPLATES = 'email_templates';
const ADMIN_LOGS = 'admin_logs';
const TEMPLATE_ID = 'speaker.reminder';

/** Most speakers one preview or send may name. */
const MAX_RECIPIENTS = 200;
/** A speaker gets at most one reminder in this window. */
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** A send still marked "sending" after this long is treated as abandoned. */
const SENDING_STALE_MS = 10 * 60 * 1000;
/** Longest saved subject, html or text body, in characters. */
const MAX_TEMPLATE_FIELD_LENGTH = 100 * 1024;
const BATCH_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Export groups: which speakers a file holds. */
const EXPORT_GROUPS = Object.freeze(['any', 'all', ...READINESS_ITEMS]);

/** Why a chosen speaker gets no reminder, in staff words. */
const SKIP_REASONS = Object.freeze({
  'not-found': 'There is no speaker record with this id.',
  'not-accepted': 'This speaker has not accepted an invitation.',
  'no-email': 'This speaker has no email address.',
  'nothing-missing': 'Nothing in the chosen items is missing.',
  recent: 'This speaker was reminded less than 24 hours ago.',
  'in-progress': 'A reminder to this speaker is being sent now.',
});

const REQUEST_ACTIONS = Object.freeze([
  'list', 'preview', 'send', 'export', 'template', 'saveTemplate', 'resetTemplate',
]);

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

/** One row of the staff list. */
function listRow(speakerId, speaker, stores, nowMs) {
  const readiness = readinessFor(stores, speakerId, speaker);
  const state = stores.reminders.get(speakerId) ?? null;
  const until = cooldownUntil(state, nowMs);
  return {
    id: speakerId,
    name: speakerDisplayName(speaker) || speakerId,
    status: speaker.status,
    hasEmail: typeof speaker.email === 'string' && speaker.email.trim() !== '',
    readiness,
    lastRemindedAt: isoOrNull(state?.lastSentAt),
    lastRemindedItems: Array.isArray(state?.lastItems) ? state.lastItems : [],
    canRemindAfter: until ? new Date(until).toISOString() : null,
  };
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
function reminderTokenValues({ config, speaker, readiness, items, actor }) {
  const site = siteUrl(config);
  const wants = (item) => items.includes(item);
  return {
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
function renderReminder({ template, override, config, speaker, readiness, items, actor }) {
  const { render } = require('../email/render.cjs');
  const { withLegalFooter } = require('../email/send.cjs');
  const tokenValues = reminderTokenValues({ config, speaker, readiness, items, actor });
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

/** @returns {{ speakerIds: string[], topics: string[] }} */
function readSelection(body) {
  const raw = body?.speakerIds;
  if (!Array.isArray(raw) || raw.length === 0) fail(400, 'bad-request', 'speakerIds: Choose at least one speaker.');
  if (raw.length > MAX_RECIPIENTS) fail(400, 'bad-request', `speakerIds: Choose at most ${MAX_RECIPIENTS} speakers at a time.`);
  if (!raw.every(isValidDocId)) fail(400, 'bad-request', 'speakerIds: Each entry must be a speaker id.');
  const speakerIds = [...new Set(raw)];
  if (body?.topics !== undefined && !Array.isArray(body.topics)) fail(400, 'bad-request', 'topics: Must be a list.');
  if (Array.isArray(body?.topics) && body.topics.some((topic) => !READINESS_ITEMS.includes(topic))) {
    fail(400, 'bad-request', `topics: Each entry must be one of ${READINESS_ITEMS.join(', ')}.`);
  }
  return { speakerIds, topics: normalizeReadinessTopics(body?.topics) };
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

// --- actions ---------------------------------------------------------------

async function listAction({ db, now }) {
  const stores = await loadReadinessStores(db);
  const nowMs = now();
  const speakers = remindableEntries(stores)
    .map(({ id, speaker }) => listRow(id, speaker, stores, nowMs))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { speakers, cooldownHours: REMINDER_COOLDOWN_MS / 3600000, maxRecipients: MAX_RECIPIENTS };
}

async function previewAction({ db, getConfig, now, actor, body }) {
  const selection = readSelection(body);
  const [stores, config, loaded] = await Promise.all([
    loadReadinessStores(db), getConfig(), loadReminderTemplate(db, now),
  ]);
  const { recipients, skipped } = sortSelection({ ...selection, stores, nowMs: now() });
  let usedFallback = false;
  const messages = recipients.map((recipient) => {
    const out = renderReminder({ ...loaded, config, ...recipient, actor });
    usedFallback = usedFallback || out.usedFallback;
    return {
      speakerId: recipient.speakerId,
      name: recipient.name,
      to: out.message.to,
      items: recipient.items,
      ...out.delivered,
    };
  });
  return { topics: selection.topics, recipients: messages, skipped, usedFallback };
}

/**
 * Reserve one speaker for one batch, or say why not.
 * @returns {Promise<{ ok: true, sentCount: number } | { ok: false, outcome: string, reason?: string }>}
 */
async function reserve({ db, speakerId, batchId, actor, nowMs }) {
  const ref = db.collection(REMINDERS).doc(speakerId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = snap.exists ? snap.data() : {};
    if (state.lastBatchId === batchId) {
      // Replays never send. What the first request did is the answer.
      if (state.lastStatus === 'failed') return { ok: false, outcome: 'failed' };
      return { ok: false, outcome: 'already-sent' };
    }
    const attempt = timestampMs(state.lastAttemptAt);
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
    }, { merge: true });
    return { ok: true, sentCount: Number.isInteger(state.sentCount) ? state.sentCount : 0 };
  });
}

async function sendAction({ db, getConfig, sendEmail, now, log, actor, body }) {
  const selection = readSelection(body);
  const batchId = body?.batchId;
  if (typeof batchId !== 'string' || !BATCH_ID_RE.test(batchId)) {
    fail(400, 'bad-request', 'batchId: Preview the reminders again, then send.');
  }
  if (!Number.isInteger(body?.confirmCount) || body.confirmCount !== selection.speakerIds.length) {
    fail(400, 'bad-request', 'confirmCount: Confirm the number of recipients the preview showed.');
  }
  await requireWritable(db);

  const [stores, config, loaded] = await Promise.all([
    loadReadinessStores(db), getConfig(), loadReminderTemplate(db, now),
  ]);
  // The cooldown is decided in each reservation, so a replay of this batch
  // reports what happened instead of "reminded less than 24 hours ago".
  const { recipients, skipped } = sortSelection({ ...selection, stores, nowMs: now(), checkCooldown: false });

  // Every message is rendered before the first one goes: a template or
  // configuration fault refuses the batch whole, not half way through.
  const prepared = recipients.map((recipient) => ({
    recipient,
    rendered: renderReminder({ ...loaded, config, ...recipient, actor }),
  }));

  const sent = [];
  const alreadySent = [];
  const failed = [];
  for (const { recipient, rendered } of prepared) {
    const { speakerId, name, items } = recipient;
    const nowMs = now();
    const reservation = await reserve({ db, speakerId, batchId, actor, nowMs });
    if (!reservation.ok) {
      if (reservation.outcome === 'already-sent') alreadySent.push({ speakerId, name });
      else if (reservation.outcome === 'failed') failed.push({ speakerId, name });
      else skipped.push({ speakerId, name, reason: reservation.reason, message: SKIP_REASONS[reservation.reason] });
      continue;
    }
    let result;
    try {
      result = await sendEmail({ ...rendered.message, onceKey: `speaker-reminder:${speakerId}:${batchId}` });
    } catch (err) {
      log.error('speaker.reminder send threw', err);
      result = { status: 'failed' };
    }
    const ok = result?.status === 'sent';
    const ref = db.collection(REMINDERS).doc(speakerId);
    try {
      await ref.set(ok
        ? {
          lastStatus: 'sent',
          lastSentAt: new Date(nowMs),
          lastSentBy: actor.email,
          lastItems: items,
          sentCount: reservation.sentCount + 1,
        }
        : { lastStatus: 'failed' }, { merge: true });
    } catch (err) {
      log.warn('speaker_reminders stamp failed', err);
    }
    (ok ? sent : failed).push({ speakerId, name });
  }

  await logAdminAction({
    db,
    action: 'sendSpeakerReminders',
    docPath: REMINDERS,
    actor,
    now,
    log,
    details: {
      batchId,
      topics: selection.topics,
      requested: selection.speakerIds.length,
      sent: sent.map((row) => row.speakerId),
      alreadySent: alreadySent.length,
      skipped: skipped.length,
      failed: failed.map((row) => row.speakerId),
    },
  });

  return { batchId, sent, alreadySent, skipped, failed };
}

const CSV_HEADERS = Object.freeze([
  'Name', 'Email', 'Status', 'Missing', 'Sessions without a description', 'Sessions without materials', 'Last reminded',
]);

function csvForRows(rows, stores) {
  const { internals: { escapeCell } } = require('../users/export.cjs');
  const lines = [CSV_HEADERS.map(escapeCell).join(',')];
  for (const row of rows) {
    const speaker = stores.speakers.get(row.id) ?? {};
    lines.push([
      row.name,
      typeof speaker.email === 'string' ? speaker.email.trim() : '',
      row.status,
      row.readiness.missing.map((item) => READINESS_ITEM_LABELS[item]).join('; '),
      row.readiness.descriptionSessions.map((session) => session.title).join('; '),
      row.readiness.materialsSessions.map((session) => session.title).join('; '),
      row.lastRemindedAt ?? '',
    ].map(escapeCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

async function exportAction({ db, now, actor, body }) {
  const group = body?.group ?? 'any';
  if (!EXPORT_GROUPS.includes(group)) fail(400, 'bad-request', `group: Must be one of ${EXPORT_GROUPS.join(', ')}.`);
  const stores = await loadReadinessStores(db);
  const nowMs = now();
  const rows = remindableEntries(stores)
    .map(({ id, speaker }) => listRow(id, speaker, stores, nowMs))
    .filter((row) => {
      if (group === 'all') return true;
      if (group === 'any') return row.readiness.missing.length > 0;
      return row.readiness.missing.includes(group);
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const csv = csvForRows(rows, stores);
  // An egress, not a mutation: no audit row, no file (users/export.cjs).
  try {
    await db.collection(ADMIN_LOGS).doc().set({
      action: 'exportSpeakerReadiness',
      docPath: SPEAKERS,
      uid: actor.uid,
      email: actor.email,
      at: new Date(nowMs),
      details: { group, rowCount: rows.length },
    });
  } catch {
    fail(500, 'internal', 'The export could not be recorded, so no file was made. Try again.');
  }
  const stamp = new Date(nowMs).toISOString().slice(0, 10);
  return { filename: `speaker-readiness-${group}-${stamp}.csv`, csv, rowCount: rows.length };
}

function templateFields(source) {
  return { subject: source.subject, html: source.html, text: source.text };
}

async function templateAction({ db }) {
  const { getDefaultTemplate } = require('../email/templates.cjs');
  const { GLOBAL_TOKEN_NAMES } = require('../email/render.cjs');
  const template = getDefaultTemplate(TEMPLATE_ID);
  const snap = await db.collection(TEMPLATES).doc(TEMPLATE_ID).get();
  const saved = snap.exists ? snap.data() : null;
  return {
    id: TEMPLATE_ID,
    shipped: templateFields(template),
    saved: saved
      ? {
        subject: typeof saved.subject === 'string' ? saved.subject : template.subject,
        html: typeof saved.html === 'string' ? saved.html : template.html,
        text: typeof saved.text === 'string' ? saved.text : template.text,
        updatedAt: isoOrNull(saved.updatedAt),
        updatedBy: typeof saved.updatedBy === 'string' ? saved.updatedBy : null,
      }
      : null,
    reminderTokens: template.tokens.filter((name) => !GLOBAL_TOKEN_NAMES.includes(name)),
    globalTokens: [...GLOBAL_TOKEN_NAMES],
    requiredTokens: [...template.requiredTokens],
  };
}

async function saveTemplateAction({ db, now, log, actor, body }) {
  const { validateOverridePayload } = require('../email/templates.cjs');
  const payload = {};
  for (const key of ['subject', 'html', 'text']) {
    if (body?.[key] !== undefined) payload[key] = body[key];
  }
  for (const key of Object.keys(payload)) {
    if (typeof payload[key] === 'string' && payload[key].length > MAX_TEMPLATE_FIELD_LENGTH) {
      fail(400, 'bad-request', `${key}: Must be at most ${MAX_TEMPLATE_FIELD_LENGTH / 1024} KB.`);
    }
  }
  const check = validateOverridePayload(TEMPLATE_ID, payload);
  if (!check.ok) fail(400, 'bad-request', check.errors.join('; '));
  await requireWritable(db);
  await db.collection(TEMPLATES).doc(TEMPLATE_ID).set({
    ...payload,
    updatedAt: new Date(now()),
    updatedBy: actor.email,
  });
  await logAdminAction({ db, action: 'saveEmailTemplate', docPath: `${TEMPLATES}/${TEMPLATE_ID}`, actor, now, log });
  return templateAction({ db });
}

async function resetTemplateAction({ db, now, log, actor }) {
  await requireWritable(db);
  await db.collection(TEMPLATES).doc(TEMPLATE_ID).delete();
  await logAdminAction({ db, action: 'resetEmailTemplate', docPath: `${TEMPLATES}/${TEMPLATE_ID}`, actor, now, log });
  return templateAction({ db });
}

const ACTION_HANDLERS = {
  list: listAction,
  preview: previewAction,
  send: sendAction,
  export: exportAction,
  template: templateAction,
  saveTemplate: saveTemplateAction,
  resetTemplate: resetTemplateAction,
};

/** @param {{ db, auth, getConfig, sendEmail?, now?, log? }} deps */
function createSpeakerRemindersHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
  return async function speakerReminders(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);
    const action = req.body?.action;
    if (!REQUEST_ACTIONS.includes(action)) {
      return badRequest(res, `action: Must be one of ${REQUEST_ACTIONS.join(', ')}.`);
    }
    if (action === 'send' && typeof sendEmail !== 'function') {
      return internal(res, 'Email is not configured.');
    }
    const actor = { uid: verdict.uid, email: verdict.email };
    try {
      const result = await ACTION_HANDLERS[action]({
        db, getConfig, sendEmail, now, log, actor, body: req.body,
      });
      if (action === 'export') res.set('Cache-Control', 'no-store');
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof ReminderError) return sendError(res, err.status, err.code, err.message);
      log.error(`speakerReminders ${action} failed`, err);
      return internal(res, 'The reminder request could not be completed. Try again.');
    }
  };
}

/** Deployable export: speakerReminders. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  const secrets = (SEND_SECRETS_BY_PROVIDER[providerName] || []).map(defineSecret);

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods: ['POST'],
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    // 300 seconds: a send of MAX_RECIPIENTS messages goes one at a time.
    speakerReminders: onRequest({ region, secrets, timeoutSeconds: 300 }, withCors(async (req, res) => {
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      const getConfig = () => getEventConfig({ db });
      // The provider is built only for a send, so a provider fault never
      // breaks the list, the preview or the export.
      let sendEmail;
      if (req.body?.action === 'send') {
        const { getEmailProvider } = require('../email/providers/index.cjs');
        const { createEmailCore } = require('../email/send.cjs');
        sendEmail = createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig }).send;
      }
      await createSpeakerRemindersHandler({ db, auth: getAuth(), getConfig, sendEmail })(req, res);
    })),
  };
}

module.exports = {
  createSpeakerRemindersHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    TEMPLATE_ID,
    MAX_RECIPIENTS,
    REMINDER_COOLDOWN_MS,
    SENDING_STALE_MS,
    EXPORT_GROUPS,
    SKIP_REASONS,
    CSV_HEADERS,
    reminderTokenValues,
    renderReminder,
    readSelection,
    sortSelection,
    csvForRows,
  },
};
