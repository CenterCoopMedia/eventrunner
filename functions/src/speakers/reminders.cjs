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
 *                  preview showed (`confirmCount`), its `receipt` and a
 *                  `batchId`
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
 * A record left at "sending" for SENDING_STALE_MS (the instance died, or the
 * stamp after the send failed) is settled by the email core's claim for its
 * batch: a claim means the mail may have gone, so it counts as a reminder
 * sent at the attempt; no claim means it never reached the provider.
 *
 * THE WORDING THE PREVIEW SHOWED. Preview returns `wordingVersion`, a digest
 * of the saved wording. Send needs it, and refuses when the wording changed
 * in between, so no speaker gets wording staff did not read.
 *
 * THE MESSAGES THE PREVIEW SHOWED. Preview also returns `receipt`, a SHA-256
 * over every recipient's speaker id, address, items, subject and bodies
 * (footer included), the same idea as the announcement receipt
 * (announcements/compose.cjs). Send renders the batch again from the live
 * stores and refuses it whole, before any reservation, when the receipt
 * differs: a changed address, a speaker who supplied an item, a renamed
 * session or a changed site address all need a new preview.
 *
 * A PROVIDER THAT MAY HAVE ACCEPTED. When the provider throws after the
 * request left (the email core's `ambiguous`), the speaker may have the
 * mail. The record says `uncertain`, with `lastSentAt` set, so the 24-hour
 * window applies and a new batch cannot send a second copy. The response
 * lists the speaker under `uncertain`, not `failed`.
 *
 * Historical demos refuse every write here (send, saveTemplate,
 * resetTemplate) before anything is stored; core/demoWrites.cjs.
 *
 * The readiness read, the selection, the rendering and the reserve, send
 * and stamp of one speaker live in reminderCore.cjs, so the reminder
 * schedule (ADR 0006) uses the same rules as this endpoint.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const crypto = require('node:crypto');
const { logAdminAction, isValidDocId } = require('../cms/store.cjs');
const { speakerDisplayName } = require('shared/speaker');
const {
  READINESS_ITEMS,
  READINESS_ITEM_LABELS,
  normalizeReadinessTopics,
} = require('shared/speakerReadiness');
const {
  SPEAKERS,
  REMINDERS,
  TEMPLATE_ID,
  REMINDER_COOLDOWN_MS,
  SENDING_STALE_MS,
  SHIPPED_WORDING,
  SKIP_REASONS,
  ReminderError,
  fail,
  isoOrNull,
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
  sendOne,
} = require('./reminderCore.cjs');

const TEMPLATES = 'email_templates';
const ADMIN_LOGS = 'admin_logs';

/** Most speakers one preview or send may name. */
const MAX_RECIPIENTS = 200;
/** Longest saved subject, html or text body, in characters. */
const MAX_TEMPLATE_FIELD_LENGTH = 100 * 1024;
const BATCH_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const RECEIPT_RE = /^[0-9a-f]{64}$/;

/** Export groups: which speakers a file holds. */
const EXPORT_GROUPS = Object.freeze(['any', 'all', ...READINESS_ITEMS]);

const REQUEST_ACTIONS = Object.freeze([
  'list', 'preview', 'send', 'export', 'template', 'saveTemplate', 'resetTemplate',
]);

/**
 * The digest a send must match: every message the preview showed, in order.
 * @param {{ speakerId: string, to: string, items: string[], subject: string,
 *   html: string, text: string }[]} messages
 */
function reminderReceipt(messages) {
  const canonical = JSON.stringify({
    v: 1,
    messages: messages.map((m) => [m.speakerId, m.to, m.items, m.subject, m.html ?? null, m.text ?? null]),
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
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
  return {
    topics: selection.topics,
    recipients: messages,
    skipped,
    usedFallback,
    wordingVersion: wordingVersion(loaded.override),
    receipt: reminderReceipt(messages),
  };
}

/**
 * What a send would deliver now, rendered from the live stores, and its
 * receipt. The cooldown is left to each reservation, so a replay of a batch
 * reports what happened instead of "reminded less than 24 hours ago".
 */
async function prepareBatch({ db, getConfig, now, actor, selection }) {
  const [stores, config, loaded] = await Promise.all([
    loadReadinessStores(db), getConfig(), loadReminderTemplate(db, now),
  ]);
  const { recipients, skipped } = sortSelection({ ...selection, stores, nowMs: now(), checkCooldown: false });
  // Every message is rendered before the first one goes: a template or
  // configuration fault refuses the batch whole, not half way through.
  const prepared = recipients.map((recipient) => ({
    recipient,
    rendered: renderReminder({ ...loaded, config, ...recipient, actor }),
  }));
  const receipt = reminderReceipt(prepared.map(({ recipient, rendered }) => ({
    speakerId: recipient.speakerId,
    to: rendered.message.to,
    items: recipient.items,
    ...rendered.delivered,
  })));
  return { loaded, prepared, skipped, receipt };
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
  if (typeof body?.wordingVersion !== 'string' || body.wordingVersion === '') {
    fail(400, 'bad-request', 'wordingVersion: Preview the reminders again, then send.');
  }
  if (typeof body?.receipt !== 'string' || !RECEIPT_RE.test(body.receipt)) {
    fail(400, 'bad-request', 'receipt: Preview the reminders again, then send.');
  }
  await requireWritable(db);

  const { loaded, prepared, skipped, receipt } = await prepareBatch({ db, getConfig, now, actor, selection });
  if (wordingVersion(loaded.override) !== body.wordingVersion) {
    fail(409, 'stale-preview', 'The reminder wording changed after the preview. Preview again, then send.');
  }
  if (receipt !== body.receipt) {
    fail(409, 'stale-preview', 'A recipient or a message changed after the preview. Preview again, then send.');
  }

  const sent = [];
  const alreadySent = [];
  const failed = [];
  const uncertain = [];
  let finished = false;
  try {
    for (const { recipient, rendered } of prepared) {
      const { speakerId, name } = recipient;
      const { outcome, reason } = await sendOne({ db, sendEmail, log, actor, batchId, recipient, rendered, nowMs: now() });
      if (outcome === 'sent') sent.push({ speakerId, name });
      else if (outcome === 'already-sent') alreadySent.push({ speakerId, name });
      else if (outcome === 'failed') failed.push({ speakerId, name });
      else if (outcome === 'uncertain') uncertain.push({ speakerId, name });
      else skipped.push({ speakerId, name, reason, message: SKIP_REASONS[reason] });
    }
    finished = true;
  } finally {
    // Written even when the loop stops part way (a transaction fault), so
    // every speaker this request emailed is named in the log.
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
        alreadySent: alreadySent.map((row) => row.speakerId),
        skipped: skipped.length,
        failed: failed.map((row) => row.speakerId),
        uncertain: uncertain.map((row) => row.speakerId),
        ...(finished ? {} : { incomplete: true }),
      },
    });
  }

  return { batchId, sent, alreadySent, skipped, failed, uncertain };
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
    SHIPPED_WORDING,
    EXPORT_GROUPS,
    SKIP_REASONS,
    CSV_HEADERS,
    reminderTokenValues,
    renderReminder,
    readSelection,
    sortSelection,
    csvForRows,
    wordingVersion,
    reminderReceipt,
    prepareBatch,
  },
};
