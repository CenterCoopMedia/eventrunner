'use strict';

/**
 * Site-wide announcements. Public rows contain no actor identity. Staff
 * mutations use authenticated Functions endpoints and write admin_logs.
 */
const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { internals: pagesInternals } = require('../cms/pages.cjs');
const {
  ANNOUNCEMENT_LEVELS,
  MAX_ANNOUNCEMENT_MESSAGE_LENGTH,
  MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH,
  sanitizeAnnouncementText,
} = require('shared/announcement');
const { safeUrlHref } = require('shared/urlSafety');

const { DOC_ID_RE } = pagesInternals;
const ANNOUNCEMENTS_COLLECTION = 'announcements';
const ANNOUNCEMENT_KEYS = Object.freeze(['message', 'level', 'startsAt', 'endsAt', 'link']);

function parsedDate(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function prepareAnnouncement(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['announcement: must be an object'] };
  }
  for (const key of Object.keys(input)) {
    if (!ANNOUNCEMENT_KEYS.includes(key)) errors.push(`${key}: unknown field`);
  }

  const message = sanitizeAnnouncementText(input.message);
  if (typeof input.message !== 'string' || message === '') {
    errors.push('message: must contain text');
  } else if (input.message.length > MAX_ANNOUNCEMENT_MESSAGE_LENGTH) {
    errors.push(`message: must be ${MAX_ANNOUNCEMENT_MESSAGE_LENGTH} characters or fewer`);
  }
  if (!ANNOUNCEMENT_LEVELS.includes(input.level)) {
    errors.push(`level: must be one of ${ANNOUNCEMENT_LEVELS.join(', ')}`);
  }

  const startsAt = parsedDate(input.startsAt);
  const endsAt = parsedDate(input.endsAt);
  if (!startsAt) errors.push('startsAt: must be a valid date and time');
  if (!endsAt) errors.push('endsAt: must be a valid date and time');
  if (startsAt && endsAt && startsAt >= endsAt) {
    errors.push('endsAt: must be after startsAt');
  }

  let link = null;
  if (input.link != null) {
    if (typeof input.link !== 'object' || Array.isArray(input.link)) {
      errors.push('link: must be an object or null');
    } else {
      for (const key of Object.keys(input.link)) {
        if (!['url', 'label'].includes(key)) errors.push(`link.${key}: unknown field`);
      }
      const url = safeUrlHref(input.link.url);
      const label = sanitizeAnnouncementText(input.link.label, MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH);
      if (!url) errors.push('link.url: must be an absolute http or https URL');
      if (!label) errors.push('link.label: must contain text');
      if (typeof input.link.label === 'string'
          && input.link.label.length > MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH) {
        errors.push(`link.label: must be ${MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH} characters or fewer`);
      }
      if (url && label) link = { url, label };
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    value: { message, level: input.level, startsAt, endsAt, link },
  };
}

function createSaveAnnouncementHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function saveAnnouncement(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const verdict = prepareAnnouncement(req.body?.announcement);
    if (!verdict.ok) return badRequest(res, `Invalid announcement: ${verdict.errors.join('; ')}`);
    const rawId = req.body?.id;
    if (rawId !== undefined && (typeof rawId !== 'string' || !DOC_ID_RE.test(rawId))) {
      return badRequest(res, 'id: must be a valid announcement id');
    }
    const id = rawId ?? crypto.randomUUID();
    const ref = db.collection(ANNOUNCEMENTS_COLLECTION).doc(id);
    const at = new Date(now());
    try {
      const snap = await ref.get();
      await ref.set({
        ...verdict.value,
        createdAt: snap.exists && snap.data()?.createdAt ? snap.data().createdAt : at,
        updatedAt: at,
      });
    } catch (err) {
      log.error('saveAnnouncement write failed', err);
      return internal(res, 'The announcement could not be saved.');
    }
    await logAdminAction({
      db,
      action: 'saveAnnouncement',
      docPath: `${ANNOUNCEMENTS_COLLECTION}/${id}`,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    return res.status(200).json({ id });
  };
}

function createDeleteAnnouncementHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function deleteAnnouncement(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const id = req.body?.id;
    if (typeof id !== 'string' || !DOC_ID_RE.test(id)) {
      return badRequest(res, 'id: must be a valid announcement id');
    }
    const ref = db.collection(ANNOUNCEMENTS_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return notFound(res, 'Announcement not found.');
    try {
      await ref.delete();
    } catch (err) {
      log.error('deleteAnnouncement failed', err);
      return internal(res, 'The announcement could not be deleted.');
    }
    await logAdminAction({
      db,
      action: 'deleteAnnouncement',
      docPath: `${ANNOUNCEMENTS_COLLECTION}/${id}`,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    return res.status(200).json({ id, deleted: true });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };
  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS) })) return;
    await handler(req, res);
  };
  const expose = (create) => onRequest({ region }, withCors(async (req, res) => create(buildDeps())(req, res)));
  return {
    saveAnnouncement: expose(createSaveAnnouncementHandler),
    deleteAnnouncement: expose(createDeleteAnnouncementHandler),
  };
}

module.exports = {
  prepareAnnouncement,
  createSaveAnnouncementHandler,
  createDeleteAnnouncementHandler,
  get handlers() { return buildHandlers(); },
  internals: { ANNOUNCEMENTS_COLLECTION, ANNOUNCEMENT_KEYS },
};
