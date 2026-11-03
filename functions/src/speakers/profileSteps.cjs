'use strict';

/**
 * The two server steps the speaker profile stepper adds (ADR 0008 §3):
 *
 *   saveOwnSpeakerLogistics  the Logistics step. Travel, access needs, and
 *                            audio and video needs go to
 *                            `speaker_logistics/{speakerId}`, a record only
 *                            staff can read. They never touch `speakers`,
 *                            so the public copy cannot carry them.
 *   submitOwnSpeakerProfile  the Review step. Stamps `profileSubmittedAt`
 *                            once and sends `speaker.profile_received`
 *                            once. A repeat submit changes nothing.
 *
 * Both use the own-profile gate (profile.cjs): the linked speaker, or staff.
 */

const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction, isValidDocId } = require('../cms/store.cjs');
const { checkLogistics } = require('shared/speakerLogistics');
const { speakerDisplayName } = require('shared/speaker');
const { internals: { SPEAKERS, gateSpeakerSelfOrAdmin, callerOwnsSpeaker } } = require('./profile.cjs');

const SPEAKER_LOGISTICS = 'speaker_logistics';

function refuse(status, code, message) {
  const err = new Error(code);
  err.conflict = { status, code, message };
  throw err;
}

/** The caller's own speaker record, or a refusal that does not reveal whether the id exists. */
function ownRecord(snap, gate, verb) {
  const stored = snap.exists ? snap.data() : null;
  if (!gate.isAdmin && !callerOwnsSpeaker(stored, gate.uid)) refuse(403, 'forbidden', `You may only ${verb} your own speaker profile.`);
  if (!stored) refuse(404, 'not-found', 'No such speaker.');
  return stored;
}

function respondConflict(res, err) {
  const { status, code, message } = err.conflict;
  return status === 404 ? notFound(res, message) : sendError(res, status, code, message);
}

function createSaveOwnSpeakerLogisticsHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function saveOwnSpeakerLogistics(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const speakerId = req.body?.speakerId;
    if (!isValidDocId(speakerId)) return badRequest(res, 'speakerId: required');
    const checked = checkLogistics(req.body?.logistics);
    if (!checked.ok) return badRequest(res, checked.errors.join('; '));
    const gate = await gateSpeakerSelfOrAdmin({ auth, db, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    try {
      const at = new Date(now());
      await db.runTransaction(async (tx) => {
        ownRecord(await tx.get(db.collection(SPEAKERS).doc(speakerId)), gate, 'edit');
        tx.set(db.collection(SPEAKER_LOGISTICS).doc(speakerId), { ...checked.logistics, speakerId, updatedAt: at, updatedBy: gate.email });
      });
    } catch (err) {
      if (err?.conflict) return respondConflict(res, err);
      log.error('saveOwnSpeakerLogistics failed', err);
      return internal(res, 'Your answers could not be saved. Keep this page open and try again.');
    }
    return res.status(200).json({ speakerId, logistics: checked.logistics });
  };
}

/** `{{profile_url}}` and the other values of speaker.profile_received. */
function profileReceivedValues({ config, speaker }) {
  const site = String(config?.tierA?.publicUrl || '').replace(/\/+$/, '');
  return {
    speaker_name: speakerDisplayName(speaker),
    profile_url: site ? `${site}/speaker/profile` : '',
    admin_contact_email: config?.event?.legal?.supportEmail || '',
  };
}

async function sendProfileReceived({ db, sendEmail, getConfig, speakerId, speaker, now }) {
  const { render } = require('../email/render.cjs');
  const { getDefaultTemplate, loadTemplate } = require('../email/templates.cjs');
  const config = await getConfig();
  const tokenValues = profileReceivedValues({ config, speaker });
  if (!tokenValues.profile_url) return false;
  const { override } = await loadTemplate({ db, id: 'speaker.profile_received', now });
  const rendered = render({ template: getDefaultTemplate('speaker.profile_received'), override, tokenValues, config });
  const result = await sendEmail({
    to: speaker.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tag: 'speaker.profile_received',
    source: 'speaker-profile',
    // Once per speaker: a second submit, or a retry, sends nothing.
    onceKey: `speaker-profile-received:${speakerId}`,
    storeRendered: rendered.storeRendered,
    hasLegalFooterHtml: rendered.hasLegalFooterHtml,
    hasLegalFooterText: rendered.hasLegalFooterText,
  });
  return result.status === 'sent';
}

function createSubmitOwnSpeakerProfileHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
  return async function submitOwnSpeakerProfile(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const speakerId = req.body?.speakerId;
    if (!isValidDocId(speakerId)) return badRequest(res, 'speakerId: required');
    const gate = await gateSpeakerSelfOrAdmin({ auth, db, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const at = new Date(now());
    let outcome;
    try {
      outcome = await db.runTransaction(async (tx) => {
        const ref = db.collection(SPEAKERS).doc(speakerId);
        const stored = ownRecord(await tx.get(ref), gate, 'submit');
        if (!String(stored.firstName || '').trim() || !String(stored.lastName || '').trim()) {
          refuse(400, 'bad-request', 'firstName and lastName: Add your first and last name before you submit.');
        }
        if (stored.profileSubmittedAt) return { first: false, stored };
        tx.set(ref, { profileSubmittedAt: at }, { merge: true });
        return { first: true, stored };
      });
    } catch (err) {
      if (err?.conflict) return respondConflict(res, err);
      log.error('submitOwnSpeakerProfile failed', err);
      return internal(res, 'Your profile could not be submitted. Your answers are saved; try again.');
    }
    if (!outcome.first) return res.status(200).json({ speakerId, submitted: true, replayed: true, emailed: false });

    await logAdminAction({ db, action: 'submitOwnSpeakerProfile', docPath: `${SPEAKERS}/${speakerId}`, actor: { uid: gate.uid, email: gate.email }, now, log });
    let emailed = false;
    const email = typeof outcome.stored.email === 'string' ? outcome.stored.email.trim() : '';
    if (email) {
      try {
        emailed = await sendProfileReceived({ db, sendEmail, getConfig, speakerId, speaker: { ...outcome.stored, email }, now });
      } catch (err) {
        // The submit stands; the email is a courtesy.
        log.error('speaker.profile_received send failed', err);
      }
    }
    return res.status(200).json({ speakerId, submitted: true, emailed });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = (SEND_SECRETS_BY_PROVIDER[(process.env.EVENT_EMAIL_PROVIDER || '').trim()] || []).map(defineSecret);
  const expose = (create, options = {}) => onRequest({ region, ...options }, async (req, res) => {
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    const getConfig = () => getEventConfig({ db });
    // Built on first use, so a missing provider fails only a send.
    const sendEmail = (message) => {
      const { createEmailCore } = require('../email/send.cjs');
      const { getEmailProvider } = require('../email/providers/index.cjs');
      return createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig }).send(message);
    };
    await create({ db, auth: getAuth(), getConfig, sendEmail })(req, res);
  });
  return {
    saveOwnSpeakerLogistics: expose(createSaveOwnSpeakerLogisticsHandler),
    submitOwnSpeakerProfile: expose(createSubmitOwnSpeakerProfileHandler, { secrets }),
  };
}

module.exports = {
  createSaveOwnSpeakerLogisticsHandler,
  createSubmitOwnSpeakerProfileHandler,
  profileReceivedValues,
  get handlers() { return buildHandlers(); },
};
