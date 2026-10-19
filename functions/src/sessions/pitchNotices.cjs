'use strict';

/**
 * Session pitch emails (issue #324): the receipt, the acceptance and the
 * decline.
 *
 * - A receipt goes to a person who pitches through this site's form. In the
 *   automatic receipt mode, `submitSessionPitch` queues it in the same
 *   transaction that stores the pitch and sends it after the commit. A send
 *   failure never fails the submission. Imported pitches never get one.
 * - A decision email goes only when staff send it with
 *   `sendSessionPitchNotice`, after a preview. Saving a decision sends
 *   nothing.
 *
 * Each email has a private delivery record on its pitch,
 * `notices.{receipt|accepted|rejected}`, with the state `queued`, `sent`,
 * `failed` or `unknown`. Each send attempt has its own send-once key, so a
 * retried request or a repeated decision cannot send the same attempt twice.
 * A sent email is never sent again. A failed email (the provider refused it)
 * can be retried with a new attempt number. An `unknown` email (the provider
 * threw, so it may have accepted the message) and a stale queued email can
 * be retried only when staff confirm that they checked the Email log, because
 * the new attempt can deliver a second copy. The decision itself is stored
 * apart from all of this, so a delivery failure never changes it.
 *
 * The settings document carries a `revision`. A preview returns it and a
 * send must return it, so staff send the wording they previewed. A settings
 * save must name the revision it edited, so two operators cannot silently
 * overwrite each other.
 *
 * Mail goes through the central sender (functions/src/email/send.cjs), which
 * applies the historical-demo guard, the send-once claim and the sent_emails
 * log. No queue collection exists: a queued record is a state that staff can
 * see, not work that a process drains.
 *
 * Private review notes have no token in any pitch email, so no wording can
 * send them.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');
const { render } = require('../email/render.cjs');
const { getDefaultTemplate, validateOverridePayload } = require('../email/templates.cjs');
const { pitchNoticeOverride } = require('../email/templates/pitchNotice.cjs');
const {
  PITCH_NOTICE_TEMPLATE_IDS,
  PITCH_NOTICE_DEFAULTS,
  DECISION_TEMPLATE_IDS,
  RECEIPT_MODES,
  MAX_NOTICE_SUBJECT_LENGTH,
  MAX_NOTICE_WORDING_LENGTH,
  MAX_SUBMITTER_FEEDBACK_LENGTH,
  readPitchNoticeSettings,
} = require('shared/pitch');

const PITCHES = 'session_pitches';
const SETTINGS_COLLECTION = 'session_pitch_settings';
const SETTINGS_DOC = 'notices';
const STATUSES = Object.freeze(['new', 'in_review', 'accepted', 'rejected']);
const KINDS = Object.freeze(['receipt', 'decision']);
// A queued record older than this is treated as interrupted, and staff may
// retry it. A younger one may still be sending.
const QUEUED_STALE_MS = 10 * 60 * 1000;
const MAX_SEND_BODY_BYTES = 16 * 1024;
const MAX_SETTINGS_BODY_BYTES = 128 * 1024;
const MAX_ERROR_LENGTH = 500;

function bodyBytes(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function settingsRef(db) {
  return db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC);
}

/** The delivery record slot and template for one email. */
function slotFor(kind, status) {
  if (kind === 'receipt') return { slot: 'receipt', templateId: 'pitch.receipt' };
  const templateId = DECISION_TEMPLATE_IDS[status];
  return templateId ? { slot: status, templateId } : null;
}

function onceKeyFor(pitchId, slot, attempt) {
  return `pitch-notice:${pitchId}:${slot}:${attempt}`;
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

/** A queued record built inside the transaction that claims the attempt. */
function queuedRecord({ pitchId, slot, templateId, previous, to, feedback, revision, mode, by, at }) {
  const attempt = (Number.isSafeInteger(previous?.attempt) ? previous.attempt : 0) + 1;
  return {
    state: 'queued',
    templateId,
    attempt,
    onceKey: onceKeyFor(pitchId, slot, attempt),
    mode,
    to,
    feedback: feedback ?? null,
    reviewRevision: revision,
    queuedAt: at,
    queuedBy: by,
    updatedAt: at,
    error: null,
  };
}

/**
 * Render one pitch email with the operator's wording. A stored wording that
 * no longer passes the token checks falls back to the shipped wording for
 * this render (render.cjs), so the email still goes.
 */
function renderNotice({ config, settings, templateId, pitch, feedback }) {
  const template = getDefaultTemplate(templateId);
  const entry = settings.templates[templateId];
  const override = entry.custom ? pitchNoticeOverride(templateId, entry) : null;
  const tokenValues = { pitch_title: pitch.title || '' };
  if (templateId !== 'pitch.receipt') tokenValues.submitter_feedback = feedback || '';
  const rendered = render({ template, override, tokenValues, config });
  // A subject is one line. A pitch title or note with a line break must not
  // break it, so every run of whitespace becomes one space.
  return { ...rendered, subject: rendered.subject.replace(/\s+/g, ' ').trim() };
}

function settingsRevisionOf(data) {
  return Number.isSafeInteger(data?.revision) && data.revision >= 0 ? data.revision : 0;
}

function settingsFromSnap(snap) {
  const data = snap.exists ? snap.data() : null;
  return { settings: readPitchNoticeSettings(data), revision: settingsRevisionOf(data) };
}

/**
 * Send one queued email and store its result. The result is stored only
 * while the record still holds this attempt, so a late finish cannot
 * overwrite a newer retry.
 */
async function deliverNotice({ db, sendEmail, getConfig, now = Date.now, log = console, pitchId, slot, record, pitch, settings }) {
  let outcome;
  try {
    if (typeof sendEmail !== 'function' || typeof getConfig !== 'function') {
      throw new Error('Email sending is not configured.');
    }
    const config = await getConfig();
    const rendered = renderNotice({ config, settings, templateId: record.templateId, pitch, feedback: record.feedback });
    if (rendered.usedFallback) {
      log.warn(`${record.templateId}: stored wording failed its token checks; sent the shipped wording`, rendered.overrideErrors);
    }
    outcome = await sendEmail({
      to: record.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: record.templateId,
      source: 'session-pitches',
      onceKey: record.onceKey,
      storeRendered: rendered.storeRendered,
      hasLegalFooterHtml: rendered.hasLegalFooterHtml,
      hasLegalFooterText: rendered.hasLegalFooterText,
    });
  } catch (err) {
    // The central sender throws only before it contacts the provider.
    outcome = { status: 'failed', error: String(err?.message || err) };
  }
  // A provider throw is ambiguous: the message may have been accepted.
  const state = outcome?.status === 'sent' ? 'sent' : outcome?.ambiguous ? 'unknown' : 'failed';
  const error = state === 'sent' ? null : String(outcome?.error || 'The email could not be sent.').slice(0, MAX_ERROR_LENGTH);
  const ref = db.collection(PITCHES).doc(pitchId);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data()?.notices?.[slot] : null;
      if (current?.attempt !== record.attempt || current?.state !== 'queued') return;
      const at = new Date(now());
      tx.update(ref, {
        [`notices.${slot}.state`]: state,
        [`notices.${slot}.updatedAt`]: at,
        [`notices.${slot}.error`]: error,
        ...(state === 'sent' ? { [`notices.${slot}.sentAt`]: at } : {}),
      });
    });
  } catch (err) {
    // The record stays queued and becomes retryable once it is stale.
    log.error('session pitch email record update failed', err);
  }
  if (state !== 'sent') log.warn(`${record.templateId} for ${pitchId} ${state}: ${error}`);
  return { state, error };
}

/**
 * The automatic receipt record that submitSessionPitch creates with a new
 * pitch, or null. It reads the settings and the demo policy inside the
 * pitch transaction, so a change to either retries the transaction.
 */
async function automaticReceipt({ db, tx, pitchId, email, at }) {
  const [settingsSnap, policy] = await Promise.all([
    tx.get(settingsRef(db)),
    checkDemoWrites({ db, transaction: tx }),
  ]);
  const settings = readPitchNoticeSettings(settingsSnap.exists ? settingsSnap.data() : null);
  if (settings.receiptMode !== 'automatic' || policy.code === 'read-only-demo') return null;
  return {
    settings,
    record: queuedRecord({
      pitchId, slot: 'receipt', templateId: 'pitch.receipt', previous: null, to: email,
      feedback: null, revision: 0, mode: 'automatic', by: 'automatic', at,
    }),
  };
}

function readSendRequest(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!isValidDocId(source.id)) return { ok: false, message: 'id: must be a session pitch id.' };
  if (!KINDS.includes(source.kind)) return { ok: false, message: `kind: must be one of ${KINDS.join(', ')}.` };
  if (!STATUSES.includes(source.expectedStatus)) {
    return { ok: false, message: `expectedStatus: must be one of ${STATUSES.join(', ')}.` };
  }
  if (!Number.isSafeInteger(source.expectedRevision) || source.expectedRevision < 0) {
    return { ok: false, message: 'expectedRevision: must be a non-negative whole number.' };
  }
  if (source.preview !== undefined && typeof source.preview !== 'boolean') {
    return { ok: false, message: 'preview: must be true or false.' };
  }
  if (source.confirmUnknown !== undefined && typeof source.confirmUnknown !== 'boolean') {
    return { ok: false, message: 'confirmUnknown: must be true or false.' };
  }
  const settingsRevision = source.expectedSettingsRevision;
  if (source.preview !== true && (!Number.isSafeInteger(settingsRevision) || settingsRevision < 0)) {
    return { ok: false, message: 'expectedSettingsRevision: Preview the email first, then send it with the preview’s settingsRevision.' };
  }
  const raw = source.feedback;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { ok: false, message: 'feedback: must be text.' };
  const feedback = typeof raw === 'string' && raw.trim() ? raw.replace(/\r\n?/g, '\n').trim() : null;
  if (feedback && source.kind === 'receipt') return { ok: false, message: 'feedback: A receipt has no note. Remove the note.' };
  if (feedback && feedback.length > MAX_SUBMITTER_FEEDBACK_LENGTH) {
    return { ok: false, message: `feedback: at most ${MAX_SUBMITTER_FEEDBACK_LENGTH} characters.` };
  }
  return {
    ok: true,
    id: source.id,
    kind: source.kind,
    expectedStatus: source.expectedStatus,
    expectedRevision: source.expectedRevision,
    preview: source.preview === true,
    confirmUnknown: source.confirmUnknown === true,
    expectedSettingsRevision: settingsRevision,
    feedback,
  };
}

/** Check one stored pitch against a send request. Returns a refusal or the target. */
function evaluate(stored, request, nowMs) {
  if (!stored) return { status: 404, code: 'not-found', message: 'No such session pitch.' };
  const revision = Number.isSafeInteger(stored.reviewRevision) ? stored.reviewRevision : 0;
  if (stored.status !== request.expectedStatus || revision !== request.expectedRevision) {
    return { status: 409, code: 'status-conflict', message: 'The session pitch changed. Load the current review and try again.' };
  }
  const target = slotFor(request.kind, stored.status);
  if (!target) {
    return { status: 400, code: 'bad-request', message: 'Save an accepted or declined decision before you send a decision email.' };
  }
  if (request.kind === 'receipt' && !stored.uid) {
    return { status: 400, code: 'bad-request', message: 'Imported pitches do not get a receipt.' };
  }
  if (typeof stored.email !== 'string' || !stored.email) {
    return { status: 400, code: 'bad-request', message: 'This pitch has no email address.' };
  }
  const previous = stored.notices?.[target.slot] || null;
  if (previous?.state === 'sent') {
    return { status: 409, code: 'already-sent', message: 'This email was already sent. It is not sent again.' };
  }
  let mayHaveBeenSent = previous?.state === 'unknown';
  if (previous?.state === 'queued') {
    const queuedAt = toMillis(previous.queuedAt);
    if (queuedAt === null || nowMs - queuedAt < QUEUED_STALE_MS) {
      return { status: 409, code: 'in-progress', message: 'This email is being sent. Check its state again in a few minutes.' };
    }
    mayHaveBeenSent = true;
  }
  if (mayHaveBeenSent && !request.preview && !request.confirmUnknown) {
    return {
      status: 409,
      code: 'delivery-unknown',
      message: 'This email may have been sent. Check the Email log, then confirm before you retry.',
    };
  }
  const otherSlot = request.kind === 'decision' ? (stored.status === 'accepted' ? 'rejected' : 'accepted') : null;
  const otherDecisionSent = otherSlot && stored.notices?.[otherSlot]?.state === 'sent' ? otherSlot : null;
  return { ...target, previous, revision, mayHaveBeenSent, otherDecisionSent };
}

function createSendSessionPitchNoticeHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
  return async function sendSessionPitchNotice(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (bodyBytes(req.body) > MAX_SEND_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    }
    const request = readSendRequest(req.body);
    if (!request.ok) return badRequest(res, request.message);
    const ref = db.collection(PITCHES).doc(request.id);

    if (request.preview) {
      try {
        const [snap, settingsSnap, config] = await Promise.all([ref.get(), settingsRef(db).get(), getConfig()]);
        const stored = snap.exists ? snap.data() : null;
        const target = evaluate(stored, request, now());
        if (target.status) return sendError(res, target.status, target.code, target.message);
        const { settings, revision: settingsRevision } = settingsFromSnap(settingsSnap);
        const rendered = renderNotice({ config, settings, templateId: target.templateId, pitch: stored, feedback: request.feedback });
        return res.status(200).json({
          preview: {
            to: stored.email,
            // Imported pitches carry the address from the CSV; nobody verified it.
            addressVerified: Boolean(stored.uid),
            templateId: target.templateId,
            subject: rendered.subject,
            text: rendered.text,
            settingsRevision,
            mayHaveBeenSent: target.mayHaveBeenSent,
            otherDecisionSent: target.otherDecisionSent,
          },
        });
      } catch (err) {
        log.error('sendSessionPitchNotice preview failed', err);
        return internal(res, 'The email preview could not be made. Try again.');
      }
    }

    let claimed;
    try {
      claimed = await db.runTransaction(async (tx) => {
        const [snap, settingsSnap, policy] = await Promise.all([
          tx.get(ref), tx.get(settingsRef(db)), checkDemoWrites({ db, transaction: tx }),
        ]);
        if (!policy.ok) return { refusal: policy };
        const stored = snap.exists ? snap.data() : null;
        const target = evaluate(stored, request, now());
        if (target.status) return { refusal: target };
        const { settings, revision: settingsRevision } = settingsFromSnap(settingsSnap);
        if (settingsRevision !== request.expectedSettingsRevision) {
          return { refusal: { status: 409, code: 'settings-changed', message: 'An operator changed the email wording. Preview the email again.' } };
        }
        const at = new Date(now());
        const record = queuedRecord({
          pitchId: request.id, slot: target.slot, templateId: target.templateId, previous: target.previous,
          to: stored.email, feedback: request.feedback, revision: target.revision, mode: 'manual', by: gate.email, at,
        });
        tx.update(ref, { [`notices.${target.slot}`]: record });
        tx.set(db.collection('admin_logs').doc(), {
          action: 'sendSessionPitchNotice',
          docPath: `${PITCHES}/${request.id}`,
          uid: gate.uid,
          email: gate.email,
          at,
          details: { templateId: target.templateId, attempt: record.attempt, status: stored.status, reviewRevision: target.revision },
        });
        return { slot: target.slot, record, pitch: { title: stored.title }, settings };
      });
    } catch (err) {
      log.error('sendSessionPitchNotice failed', err);
      return internal(res, 'The email could not be queued. Try again.');
    }
    if (claimed.refusal) {
      const { status, code, message } = claimed.refusal;
      return sendError(res, status, code, message);
    }

    const result = await deliverNotice({
      db, sendEmail, getConfig, now, log, pitchId: request.id, slot: claimed.slot,
      record: claimed.record, pitch: claimed.pitch, settings: claimed.settings,
    });
    if (result.state === 'unknown') {
      return sendError(res, 502, 'delivery-unknown', 'The email service did not answer. The email may have been sent. Check the Email log before you retry. The decision is still saved.');
    }
    if (result.state !== 'sent') {
      return sendError(res, 502, 'delivery-failed', 'The email was not sent. The decision is still saved. Retry the email later.');
    }
    return res.status(200).json({ state: 'sent', templateId: claimed.record.templateId, attempt: claimed.record.attempt });
  };
}

function readText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').trim();
  return text && text.length <= max ? text : null;
}

function readSettingsRequest(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!RECEIPT_MODES.includes(source.receiptMode)) {
    return { ok: false, message: `receiptMode: must be one of ${RECEIPT_MODES.join(', ')}.` };
  }
  if (!Number.isSafeInteger(source.expectedRevision) || source.expectedRevision < 0) {
    return { ok: false, message: 'expectedRevision: must be the revision of the settings you edited.' };
  }
  const input = source.templates ?? {};
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, message: 'templates: must be an object.' };
  for (const key of Object.keys(input)) {
    if (!PITCH_NOTICE_TEMPLATE_IDS.includes(key)) return { ok: false, message: `templates: unknown email ${key}.` };
  }
  const templates = {};
  for (const id of PITCH_NOTICE_TEMPLATE_IDS) {
    const entry = input[id];
    if (entry === undefined || entry === null) continue;
    const subject = readText(entry?.subject, MAX_NOTICE_SUBJECT_LENGTH);
    const wording = readText(entry?.wording, MAX_NOTICE_WORDING_LENGTH);
    if (!subject || subject.includes('\n')) {
      return { ok: false, message: `templates.${id}.subject: one line of 1-${MAX_NOTICE_SUBJECT_LENGTH} characters.` };
    }
    if (!wording) return { ok: false, message: `templates.${id}.wording: 1-${MAX_NOTICE_WORDING_LENGTH} characters.` };
    const check = validateOverridePayload(id, pitchNoticeOverride(id, { subject, wording }));
    if (!check.ok) return { ok: false, message: `templates.${id}: ${[...new Set(check.errors)].join('; ')}` };
    const shipped = PITCH_NOTICE_DEFAULTS[id];
    // The shipped wording is stored as no override, so a later release can improve it.
    if (subject !== shipped.subject || wording !== shipped.wording) templates[id] = { subject, wording };
  }
  return { ok: true, receiptMode: source.receiptMode, templates, expectedRevision: source.expectedRevision };
}

function createSavePitchNoticeSettingsHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function savePitchNoticeSettings(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (bodyBytes(req.body) > MAX_SETTINGS_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The settings are too large.');
    }
    const parsed = readSettingsRequest(req.body);
    if (!parsed.ok) return badRequest(res, parsed.message);
    let stored;
    try {
      stored = await db.runTransaction(async (tx) => {
        const snap = await tx.get(settingsRef(db));
        const current = settingsRevisionOf(snap.exists ? snap.data() : null);
        if (current !== parsed.expectedRevision) return null;
        const at = new Date(now());
        const next = { receiptMode: parsed.receiptMode, templates: parsed.templates, revision: current + 1 };
        tx.set(settingsRef(db), { ...next, updatedAt: at, updatedBy: gate.email });
        tx.set(db.collection('admin_logs').doc(), {
          action: 'savePitchNoticeSettings',
          docPath: `${SETTINGS_COLLECTION}/${SETTINGS_DOC}`,
          uid: gate.uid,
          email: gate.email,
          at,
          details: { receiptMode: parsed.receiptMode, editedTemplates: Object.keys(parsed.templates), revision: next.revision },
        });
        return next;
      });
    } catch (err) {
      log.error('savePitchNoticeSettings failed', err);
      return internal(res, 'The email settings could not be saved.');
    }
    if (!stored) {
      return sendError(res, 409, 'settings-conflict', 'Another operator changed the email settings. Load the current settings and try again.');
    }
    return res.status(200).json({ ...readPitchNoticeSettings(stored), revision: stored.revision });
  };
}

module.exports = {
  createSendSessionPitchNoticeHandler,
  createSavePitchNoticeSettingsHandler,
  automaticReceipt,
  deliverNotice,
  internals: {
    SETTINGS_COLLECTION,
    SETTINGS_DOC,
    QUEUED_STALE_MS,
    onceKeyFor,
    readSendRequest,
    readSettingsRequest,
    renderNotice,
  },
};
