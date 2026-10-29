'use strict';

// Upload bytes through the server: a per-object Storage rule cannot bound
// cumulative allocation. This ledger is a quota, not a work queue. A request
// reclaims expired, unreferenced slots inline before reserving a new one.
const { randomUUID } = require('node:crypto');
const { verifyAuthToken } = require('../core/auth.cjs');
const { sendError, badRequest, internal, methodNotAllowed } = require('../core/errors.cjs');

const LEDGERS = 'profile_photo_uploads';
const MAX_OBJECTS = 4;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PER_HOUR = 10;
const HOUR = 60 * 60 * 1000;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function failure(status, code, message) {
  return Object.assign(new Error(message), { http: { status, code, message } });
}

// A slot is never released before Storage confirms deletion. Failed uploads
// retain their reservation too: a failed response can still mean bytes landed.
async function reclaim({ db, bucket, uid, now }) {
  const ref = db.collection(LEDGERS).doc(uid);
  const expired = await db.runTransaction(async (tx) => {
    const ledger = await tx.get(ref);
    const user = await tx.get(db.collection('users').doc(uid));
    const publicUser = await tx.get(db.collection('users_public').doc(uid));
    const data = ledger.data() || {};
    const slots = { ...data.slots };
    const paths = [user.data()?.photoPath, publicUser.data()?.photoPath];
    const found = [];
    for (const [id, slot] of Object.entries(slots)) {
      if (paths.includes(slot.path) || slot.expiresAtMs > now()) continue;
      slots[id] = { ...slot, state: 'deleting' };
      found.push({ id, path: slot.path });
    }
    // Firestore rules refuse a new reference to a deleting slot. A save of
    // that slot conflicts with this transaction's user read and is retried.
    if (found.length) tx.set(ref, { ...data, slots });
    return found;
  });
  for (const { id, path } of expired) {
    await bucket.file(path).delete({ ignoreNotFound: true });
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data();
      const slots = { ...data.slots };
      if (slots[id]?.state !== 'deleting') return;
      delete slots[id];
      tx.set(ref, { ...data, slots });
    });
  }
}

function createProfilePhotoUploadHandler({ db, bucket, auth, render,
  verify = verifyAuthToken, now = Date.now, newId = randomUUID, log = console }) {
  return async function profilePhotoUpload(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const actor = await verify({ auth }, req);
    if (!actor?.uid) return sendError(res, 401, 'unauthorized', 'Authentication required.');
    const { uid } = actor; // Never take the owner or path from the payload.
    const contentType = req.body?.contentType;
    if (contentType !== undefined && !Object.hasOwn(TYPES, contentType)) return badRequest(res, 'contentType: use PNG, JPEG, or WebP.');
    const data = req.body?.data;
    if (typeof data !== 'string' || data.length > 4 * Math.ceil(MAX_BYTES / 3)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return badRequest(res, 'data: invalid photo.');
    const buffer = Buffer.from(data, 'base64');
    if (!buffer.length || buffer.length >= MAX_BYTES) return badRequest(res, 'data: photo must be under 2 MiB.');
    const ledgerRef = db.collection(LEDGERS).doc(uid);
    const userRef = db.collection('users').doc(uid);
    try {
      // Charge attempts before cleanup, so refusals cannot drive unbounded
      // bucket operations. Transactions serialize requests from many tabs.
      await db.runTransaction(async (tx) => {
        const user = await tx.get(userRef);
        const snap = await tx.get(ledgerRef);
        if (!user.exists) throw failure(403, 'forbidden', 'A live account is required.');
        const stored = snap.data() || {};
        const at = now();
        const recent = stored.windowStartMs > at - HOUR;
        const count = recent ? stored.count || 0 : 0;
        if (count >= MAX_PER_HOUR) throw failure(429, 'photo-rate-limit', 'Too many photo uploads. Try again in an hour.');
        tx.set(ledgerRef, { ...stored, windowStartMs: recent ? stored.windowStartMs : at, count: count + 1 });
      });
      let output;
      try {
        output = await render(buffer);
      } catch {
        return badRequest(res, 'Choose a still PNG, JPEG or WebP under 2 MiB and 40 megapixels.');
      }
      if (!Buffer.isBuffer(output) || !output.length || output.length >= MAX_BYTES) {
        return badRequest(res, 'The processed photo must be under 2 MiB.');
      }
      await reclaim({ db, bucket, uid, now });
      const id = newId();
      const path = `profile-photos/${uid}/${id}/photo.webp`;
      const expiresAtMs = await db.runTransaction(async (tx) => {
        const user = await tx.get(userRef);
        const snap = await tx.get(ledgerRef);
        if (!user.exists) throw failure(403, 'forbidden', 'A live account is required.');
        const stored = snap.data() || {};
        const slots = { ...stored.slots };
        if (Object.keys(slots).length >= MAX_OBJECTS) {
          throw failure(429, 'photo-quota', 'Photo storage is full. Try again in an hour.');
        }
        const expiresAtMs = now() + HOUR;
        slots[id] = { path, state: 'uploading', expiresAtMs };
        tx.set(ledgerRef, { ...stored, slots });
        return expiresAtMs;
      });
      await bucket.file(path).save(output, {
        resumable: false,
        metadata: { contentType: 'image/webp', cacheControl: 'public, max-age=3600',
          metadata: { profilePhotoValidated: 'v1' } },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      const active = await db.runTransaction(async (tx) => {
        const user = await tx.get(userRef);
        const snap = await tx.get(ledgerRef);
        if (!user.exists || !snap.data()?.slots?.[id]) return false;
        const stored = snap.data();
        const slots = { ...stored.slots };
        if (slots[id].state !== 'uploading' || slots[id].expiresAtMs <= now()) return false;
        slots[id] = { ...slots[id], state: 'ready' };
        tx.set(ledgerRef, { ...stored, slots });
        return true;
      });
      if (!active) {
        // The account read guard keeps a late object private if cleanup fails.
        await bucket.file(path).delete({ ignoreNotFound: true });
        return sendError(res, 409, 'photo-expired', 'The photo upload expired. Try again.');
      }
      return res.status(200).json({ path, expiresAtMs });
    } catch (err) {
      if (err.http) return sendError(res, err.http.status, err.http.code, err.http.message);
      log.error('profilePhotoUpload failed', err);
      return internal(res, 'The photo could not be uploaded.');
    }
  };
}

module.exports = { createProfilePhotoUploadHandler, reclaim, MAX_OBJECTS, MAX_BYTES, MAX_PER_HOUR, HOUR };
