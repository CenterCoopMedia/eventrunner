'use strict';

/**
 * Speaker mail wording (issue #204): staff change the words of the speaker
 * invitation (`speaker.invite`) and the acceptance confirmation
 * (`speaker.accepted`). The tokens each message may use, and the link each
 * one must keep, stay fixed in code (email/templates/*.cjs).
 *
 * One admin endpoint, `speakerMailTemplates`, staff tier (the tier that
 * sends invitations), with an `action`:
 *
 *   templates      the shipped and the saved wording of both messages, the
 *                  tokens each may use, and why saved wording fails its
 *                  check, if it does
 *   preview        the exact subject, html and text one message would have,
 *                  footer included, with sample values; the wording in the
 *                  request when it carries any (checked as a save is), else
 *                  the saved wording read fresh, else the shipped copy
 *   saveTemplate   save new wording, checked by validateOverridePayload
 *   resetTemplate  delete the saved wording; the shipped copy applies again
 *
 * Every action but templates takes a `templateId`. The send paths in
 * invites.cjs read these two overrides on every render (templates.cjs), so
 * the next invitation or acceptance uses wording saved here. The preview
 * builds its token values with the same helpers the sends use.
 *
 * Historical demos refuse save and reset before anything is stored
 * (core/demoWrites.cjs). Both write an admin_logs row.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const {
  WordingError,
  MAX_WORDING_FIELD_LENGTH,
  readWording,
  readDraft,
  saveWording,
  resetWording,
  renderWording,
} = require('../email/templateWording.cjs');
const { inviteTokenValues, acceptedTokenValues } = require('./invites.cjs');

const TEMPLATE_IDS = Object.freeze(['speaker.invite', 'speaker.accepted']);
const REQUEST_ACTIONS = Object.freeze(['templates', 'preview', 'saveTemplate', 'resetTemplate']);

/** The speaker every preview addresses. Not a real record. */
const SAMPLE_SPEAKER = Object.freeze({ firstName: 'Sample', lastName: 'Speaker' });
/** Stands in for the private code a real invitation link carries. */
const SAMPLE_INVITE_CODE = 'sample-invite-code';

function readTemplateId(body) {
  const id = body?.templateId;
  if (!TEMPLATE_IDS.includes(id)) {
    throw new WordingError(400, 'bad-request', `templateId: Must be one of ${TEMPLATE_IDS.join(', ')}.`);
  }
  return id;
}

/** The sample values and the link the message must carry, per template. */
function sampleValues(id, config, actor) {
  if (id === 'speaker.invite') {
    const values = inviteTokenValues({
      config, speaker: SAMPLE_SPEAKER, token: SAMPLE_INVITE_CODE, inviteType: 'speaker', actor,
    });
    return { values, link: values.invite_url };
  }
  const values = acceptedTokenValues({ config, speaker: SAMPLE_SPEAKER });
  return { values, link: values.profile_wizard_url };
}

async function templatesAction({ db }) {
  const templates = [];
  for (const id of TEMPLATE_IDS) templates.push(await readWording({ db, id }));
  return { templates, maxFieldKb: MAX_WORDING_FIELD_LENGTH / 1024 };
}

async function previewAction({ db, getConfig, now, actor, body }) {
  const id = readTemplateId(body);
  const draft = readDraft(id, body, { required: false });
  const config = await getConfig();
  const { values, link } = sampleValues(id, config, actor);
  const rendered = await renderWording({ db, id, draft, tokenValues: values, config, now });
  // Both links are built from the public site address. Without it the
  // message has no working link; the invite send refuses a body that lost
  // its link (invites.cjs sendInviteEmail).
  const problems = [];
  const hasSite = String(config?.tierA?.publicUrl || '').trim() !== '';
  if (!hasSite || !link || !rendered.html.includes(link) || !rendered.text.includes(link)) {
    problems.push('This message has no working link, because the event has no public site address. Set it in event settings.');
  }
  return { preview: { id, ...rendered, problems } };
}

async function saveTemplateAction({ db, now, log, actor, body }) {
  const id = readTemplateId(body);
  return { template: await saveWording({ db, id, body, actor, now, log }) };
}

async function resetTemplateAction({ db, now, log, actor, body }) {
  const id = readTemplateId(body);
  return { template: await resetWording({ db, id, actor, now, log }) };
}

const ACTION_HANDLERS = {
  templates: templatesAction,
  preview: previewAction,
  saveTemplate: saveTemplateAction,
  resetTemplate: resetTemplateAction,
};

/** @param {{ db, auth, getConfig, now?, log? }} deps */
function createSpeakerMailTemplatesHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function speakerMailTemplates(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);
    const action = req.body?.action;
    if (!REQUEST_ACTIONS.includes(action)) {
      return badRequest(res, `action: Must be one of ${REQUEST_ACTIONS.join(', ')}.`);
    }
    const actor = { uid: verdict.uid, email: verdict.email };
    try {
      const result = await ACTION_HANDLERS[action]({ db, getConfig, now, log, actor, body: req.body });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof WordingError) return sendError(res, err.status, err.code, err.message);
      log.error(`speakerMailTemplates ${action} failed`, err);
      return internal(res, 'The wording request could not be completed. Try again.');
    }
  };
}

/** Deployable export: speakerMailTemplates. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    speakerMailTemplates: onRequest({ region }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      const handled = applyCors(req, res, {
        allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
        methods: ['POST'],
      });
      if (handled) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      await createSpeakerMailTemplatesHandler({
        db, auth: getAuth(), getConfig: () => getEventConfig({ db }),
      })(req, res);
    }),
  };
}

module.exports = {
  createSpeakerMailTemplatesHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    TEMPLATE_IDS,
    SAMPLE_SPEAKER,
    SAMPLE_INVITE_CODE,
    MAX_WORDING_FIELD_LENGTH,
    sampleValues,
  },
};
