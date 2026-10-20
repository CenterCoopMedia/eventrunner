'use strict';

/**
 * Staff editing of one template's saved wording: the
 * `email_templates/{id}` override (spec §6.1). Read, save, reset and
 * render, for any shipped template id. The tokens a template declares and
 * the tokens it requires stay fixed in code; only subject, html and text
 * are saved.
 *
 * Save runs validateOverridePayload (templates.cjs), so an unknown token,
 * a malformed placeholder or a dropped required link is refused before
 * anything is stored. Save and reset refuse on a historical demo
 * (core/demoWrites.cjs) and write an admin_logs row.
 *
 * The speaker mail endpoint (speakers/mailTemplates.cjs) uses this. The
 * reminder editor in speakers/reminders.cjs predates it and keeps its own
 * copy of the same steps.
 */

const { getDefaultTemplate, loadTemplate, validateOverridePayload } = require('./templates.cjs');

const TEMPLATES = 'email_templates';
const WORDING_FIELDS = Object.freeze(['subject', 'html', 'text']);
/** Longest saved subject, html or text body, in characters. */
const MAX_WORDING_FIELD_LENGTH = 100 * 1024;

class WordingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new WordingError(status, code, message);
}

function isoOrNull(value) {
  let ms = NaN;
  if (value && typeof value.toMillis === 'function') ms = value.toMillis();
  else if (value instanceof Date) ms = value.getTime();
  else if (typeof value === 'string') ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The wording fields of a stored override, as a candidate payload. */
function storedWording(data) {
  const out = {};
  for (const key of WORDING_FIELDS) if (key in data) out[key] = data[key];
  return out;
}

/**
 * The shipped and the saved wording of one template, and its tokens.
 * `savedErrors` lists why saved wording fails its check; the renderer then
 * sends the shipped copy instead (render.cjs).
 */
async function readWording({ db, id }) {
  const { GLOBAL_TOKEN_NAMES } = require('./render.cjs');
  const template = getDefaultTemplate(id);
  const snap = await db.collection(TEMPLATES).doc(id).get();
  const data = snap.exists ? snap.data() : null;
  let saved = null;
  let savedErrors = [];
  if (data) {
    saved = {
      subject: typeof data.subject === 'string' ? data.subject : template.subject,
      html: typeof data.html === 'string' ? data.html : template.html,
      text: typeof data.text === 'string' ? data.text : template.text,
      updatedAt: isoOrNull(data.updatedAt),
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    };
    const check = validateOverridePayload(id, storedWording(data));
    if (!check.ok) savedErrors = check.errors;
  }
  return {
    id,
    shipped: { subject: template.subject, html: template.html, text: template.text },
    saved,
    savedErrors,
    tokens: template.tokens.filter((name) => !GLOBAL_TOKEN_NAMES.includes(name)),
    globalTokens: [...GLOBAL_TOKEN_NAMES],
    requiredTokens: [...template.requiredTokens],
  };
}

/**
 * The wording a request carries, checked as a save would check it.
 * @returns {object|null} the payload, or null when the body names no field
 */
function readDraft(id, body, { required = true } = {}) {
  const payload = {};
  for (const key of WORDING_FIELDS) {
    if (body?.[key] !== undefined) payload[key] = body[key];
  }
  if (!required && Object.keys(payload).length === 0) return null;
  for (const key of Object.keys(payload)) {
    if (typeof payload[key] === 'string' && payload[key].length > MAX_WORDING_FIELD_LENGTH) {
      fail(400, 'bad-request', `${key}: Must be at most ${MAX_WORDING_FIELD_LENGTH / 1024} KB.`);
    }
  }
  const check = validateOverridePayload(id, payload);
  if (!check.ok) fail(400, 'bad-request', check.errors.join('; '));
  return payload;
}

async function requireWritable(db) {
  const { checkDemoWrites } = require('../core/demoWrites.cjs');
  const policy = await checkDemoWrites({ db });
  if (!policy.ok) fail(policy.status, policy.code, policy.message);
}

/** Check, store and log new wording. @returns the readWording result */
async function saveWording({ db, id, body, actor, now = Date.now, log = console }) {
  const { logAdminAction } = require('../cms/store.cjs');
  const payload = readDraft(id, body);
  await requireWritable(db);
  await db.collection(TEMPLATES).doc(id).set({
    ...payload,
    updatedAt: new Date(now()),
    updatedBy: actor.email,
  });
  await logAdminAction({ db, action: 'saveEmailTemplate', docPath: `${TEMPLATES}/${id}`, actor, now, log });
  return readWording({ db, id });
}

/** Delete the saved wording, so the shipped copy applies again. */
async function resetWording({ db, id, actor, now = Date.now, log = console }) {
  const { logAdminAction } = require('../cms/store.cjs');
  await requireWritable(db);
  await db.collection(TEMPLATES).doc(id).delete();
  await logAdminAction({ db, action: 'resetEmailTemplate', docPath: `${TEMPLATES}/${id}`, actor, now, log });
  return readWording({ db, id });
}

/**
 * Render one message as the provider would get it: the draft when there is
 * one, else the saved wording read fresh, else the shipped copy; the legal
 * footer the email core adds is added here too (send.cjs withLegalFooter).
 *
 * @returns {{ source: 'draft'|'saved'|'shipped', usedFallback: boolean,
 *   overrideErrors: string[], warnings: string[], subject: string,
 *   html: string, text: string }}
 */
async function renderWording({ db, id, draft = null, tokenValues, config, now = Date.now }) {
  const { render } = require('./render.cjs');
  const { withLegalFooter } = require('./send.cjs');
  const template = getDefaultTemplate(id);
  const override = draft ?? (await loadTemplate({ db, id, now, fresh: true })).override;
  const rendered = render({ template, override, tokenValues, config });
  const delivered = withLegalFooter(rendered, config);
  let source = 'shipped';
  if (override && !rendered.usedFallback) source = draft ? 'draft' : 'saved';
  return {
    source,
    usedFallback: rendered.usedFallback,
    overrideErrors: rendered.overrideErrors,
    warnings: rendered.warnings,
    subject: rendered.subject,
    html: delivered.html,
    text: delivered.text,
  };
}

module.exports = {
  WordingError,
  WORDING_FIELDS,
  MAX_WORDING_FIELD_LENGTH,
  readWording,
  readDraft,
  saveWording,
  resetWording,
  renderWording,
};
