'use strict';

/**
 * Saved announcement messages (issue #496): reusable content for the
 * announcement email composer, kept until staff remove it.
 *
 * One staff-tier endpoint, `announcementMessages`, with an `action`:
 *
 *   list    {}                       → { messages: [{ id, name, subject, updatedAt }], max }
 *   load    { id }                   → { message: { id, name, draft, updatedAt } }
 *   save    { id?, name, draft }     → { message }   no id creates, an id updates that one
 *   rename  { id, name }             → { message }
 *   remove  { id }                   → { removed: id }
 *
 * THE STORE. `announcement_messages/{id}` is server-only (firestore.rules
 * denies every client, admins included). It is not the site banner store
 * (`announcements`, admin/announcements.cjs) and not the speaker wording
 * overrides (`email_templates`, issue #204). A record holds a label and the
 * composer's editable fields only: `name`, `subject`, `message`, `linkUrl`,
 * `linkLabel`, `createdAt`, `updatedAt`. No audience, recipient, address,
 * send id, receipt or provider result is stored: the composer resolves the
 * audience and the sender when it previews a new send.
 *
 * ONE CHECK. The draft goes through compose.cjs validateDraft, the check
 * the composer's preview and send use, so a saved message is one the
 * composer accepts. The staff text never reaches the token engine, and the
 * check refuses the render's internal slot words.
 *
 * IDS, NOT NAMES. Each message has a random id. The name is a label: two
 * messages may share one, and the list shows when each changed. Update,
 * rename, load and remove name the id. A load copies the content into the
 * composer; a later change or removal here does not change that copy or
 * any send.
 *
 * LIMITS. A name is 1 to 80 characters. The store holds at most
 * MAX_MESSAGES, so the list is one bounded read; a new save past it is
 * refused, and an update still works.
 *
 * WRITES. A historical demo refuses save, rename and remove before any
 * write (core/demoWrites.cjs). Each change writes an admin_logs row with
 * the actor and the record path, never the name or the content. List and
 * load write nothing. Nothing here contacts a mail provider or changes the
 * site.
 */

const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { validateDraft } = require('./compose.cjs');

const MESSAGES = 'announcement_messages';
const ACTIONS = Object.freeze(['list', 'load', 'save', 'rename', 'remove']);
const MAX_NAME_LENGTH = 80;
const MAX_MESSAGES = 100;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

class MessageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'MessageError';
    this.status = status;
    this.code = code;
  }
}

const invalid = (errors) => new MessageError(400, 'bad-request', `Invalid message: ${errors.join('; ')}`);

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  return null;
}

/** Whether text holds a C0 or C1 control character or DEL. */
function hasControlCharacter(text) {
  return [...text].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
}

/** The label, folded to one line, or the reasons it is refused. */
function readName(value, errors) {
  if (typeof value !== 'string') {
    errors.push('name: must contain text');
    return '';
  }
  if (hasControlCharacter(value.replace(/[\t\n\r]/g, ' '))) {
    errors.push('name: must not contain control characters');
    return '';
  }
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) errors.push('name: must contain text');
  else if (name.length > MAX_NAME_LENGTH) errors.push(`name: must be ${MAX_NAME_LENGTH} characters or fewer`);
  return name;
}

function readId(body, errors, { required = true } = {}) {
  const id = body?.id;
  if (id === undefined || id === null) {
    if (required) errors.push('id: must name a saved message');
    return null;
  }
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    errors.push('id: must name a saved message');
    return null;
  }
  return id;
}

function summaryOf(id, data) {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    subject: typeof data.subject === 'string' ? data.subject : '',
    updatedAt: toMillis(data.updatedAt),
  };
}

async function requireWritable(db) {
  const policy = await checkDemoWrites({ db });
  if (!policy.ok) throw new MessageError(policy.status, policy.code, policy.message);
}

async function audit({ db, action, id, actor, now, log }) {
  await logAdminAction({ db, action, docPath: `${MESSAGES}/${id}`, actor, now, log });
}

async function listAction({ db }) {
  const snap = await db.collection(MESSAGES).orderBy('updatedAt', 'desc').limit(MAX_MESSAGES).get();
  return { messages: snap.docs.map((doc) => summaryOf(doc.id, doc.data() || {})), max: MAX_MESSAGES };
}

async function loadAction({ db, body }) {
  const errors = [];
  const id = readId(body, errors);
  if (errors.length > 0) throw invalid(errors);
  const snap = await db.collection(MESSAGES).doc(id).get();
  if (!snap.exists) throw new MessageError(404, 'not-found', 'This saved message does not exist. It may have been removed.');
  const data = snap.data() || {};
  return {
    message: {
      ...summaryOf(id, data),
      draft: {
        subject: summaryOf(id, data).subject,
        message: typeof data.message === 'string' ? data.message : '',
        linkUrl: typeof data.linkUrl === 'string' ? data.linkUrl : '',
        linkLabel: typeof data.linkLabel === 'string' ? data.linkLabel : '',
      },
    },
  };
}

async function saveAction({ db, now, log, actor, body, newId }) {
  const errors = [];
  const id = readId(body, errors, { required: false });
  const name = readName(body?.name, errors);
  const draft = validateDraft(body?.draft);
  errors.push(...draft.errors);
  if (errors.length > 0) throw invalid(errors);
  await requireWritable(db);

  const at = new Date(now());
  const fields = {
    name,
    subject: draft.value.subject,
    message: draft.value.message,
    linkUrl: draft.value.link?.url || '',
    linkLabel: draft.value.link?.label || '',
    updatedAt: at,
  };
  if (id) {
    const ref = db.collection(MESSAGES).doc(id);
    if (!(await ref.get()).exists) throw new MessageError(404, 'not-found', 'This saved message does not exist. It may have been removed.');
    await ref.update(fields);
    await audit({ db, action: 'updateAnnouncementMessage', id, actor, now, log });
    return { message: summaryOf(id, fields) };
  }
  const count = (await db.collection(MESSAGES).count().get()).data().count;
  if (count >= MAX_MESSAGES) {
    throw new MessageError(409, 'too-many-messages', `The store holds ${MAX_MESSAGES} saved messages. Remove one before you save a new one.`);
  }
  const created = newId();
  await db.collection(MESSAGES).doc(created).create({ ...fields, createdAt: at });
  await audit({ db, action: 'createAnnouncementMessage', id: created, actor, now, log });
  return { message: summaryOf(created, fields) };
}

async function renameAction({ db, now, log, actor, body }) {
  const errors = [];
  const id = readId(body, errors);
  const name = readName(body?.name, errors);
  if (errors.length > 0) throw invalid(errors);
  await requireWritable(db);
  const ref = db.collection(MESSAGES).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new MessageError(404, 'not-found', 'This saved message does not exist. It may have been removed.');
  const updatedAt = new Date(now());
  await ref.update({ name, updatedAt });
  await audit({ db, action: 'renameAnnouncementMessage', id, actor, now, log });
  return { message: summaryOf(id, { ...snap.data(), name, updatedAt }) };
}

async function removeAction({ db, now, log, actor, body }) {
  const errors = [];
  const id = readId(body, errors);
  if (errors.length > 0) throw invalid(errors);
  await requireWritable(db);
  const ref = db.collection(MESSAGES).doc(id);
  if (!(await ref.get()).exists) throw new MessageError(404, 'not-found', 'This saved message does not exist. It may have been removed.');
  await ref.delete();
  await audit({ db, action: 'removeAnnouncementMessage', id, actor, now, log });
  return { removed: id };
}

const ACTION_HANDLERS = {
  list: listAction,
  load: loadAction,
  save: saveAction,
  rename: renameAction,
  remove: removeAction,
};

/**
 * @param {{ db: FirebaseFirestore.Firestore, auth: object, getConfig: () => Promise<object>,
 *   now?: () => number, newId?: () => string, log?: Pick<Console, 'error'|'warn'> }} deps
 */
function createAnnouncementMessagesHandler({
  db, auth, getConfig, now = Date.now, newId = () => crypto.randomUUID(), log = console,
}) {
  return async function announcementMessages(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const action = req.body?.action;
    if (!ACTIONS.includes(action)) return badRequest(res, `action: Must be one of ${ACTIONS.join(', ')}.`);
    const actor = { uid: gate.uid, email: gate.email };
    try {
      const result = await ACTION_HANDLERS[action]({ db, now, log, actor, body: req.body, newId });
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof MessageError) return sendError(res, err.status, err.code, err.message);
      log.error(`announcementMessages ${action} failed`, err);
      return internal(res, 'The saved messages are temporarily unavailable. Try again.');
    }
  };
}

/** Deployable export: announcementMessages. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    announcementMessages: onRequest({ region }, async (req, res) => {
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
      await createAnnouncementMessagesHandler({ db, auth: getAuth(), getConfig: () => getEventConfig({ db }) })(req, res);
    }),
  };
}

module.exports = {
  createAnnouncementMessagesHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: { MESSAGES, ACTIONS, MAX_NAME_LENGTH, MAX_MESSAGES, ID_RE, readName },
};
