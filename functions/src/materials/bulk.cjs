'use strict';

/**
 * Bulk materials for the admin materials page (issue #189): one list of
 * every material, and one archive of the files an admin selects.
 *
 * `listAllSessionMaterials` reads the whole `session_materials` collection
 * for the page's table and its coverage panel. `listSessionMaterials`
 * (access.cjs) needs a session and serves speakers too; the page needs
 * every session at once, and only a staff admin may have that.
 *
 * `downloadSessionMaterialsArchive` streams one zip of the selected files.
 *
 * NO SIGNED URL. The parity plan's row names short-lived signed URLs. Signing
 * needs `signBlob` (`roles/iam.serviceAccountTokenCreator`), and a fresh
 * client project does not grant it to the runtime service account; see
 * download.cjs's module doc, which reached the same wall for one file. So
 * the archive is built here and streamed through the function, the same way
 * `downloadSessionMaterial` streams one file. The intent of the plan's note
 * holds: the tier is checked on this request, and no link to a file is ever
 * written to a document. The browser holds a local object URL for one tick.
 *
 * THE ARCHIVE. yazl writes a stored (not deflated) zip: decks and PDFs are
 * already compressed. Each file is added with `addReadStreamLazy`, so yazl
 * opens a file's Storage read stream only when it reaches that entry, and
 * one read stream is open at a time. The body goes out chunked, with no
 * Content-Length: Cloud Run caps a response that is not chunked at 32 MiB.
 *
 * Everything that can refuse runs before the first byte: the ids, the
 * documents, the Storage objects, the sizes, and the audit rows. The rows
 * fail closed: one `admin_logs` row per material, committed in one batch,
 * and no archive when that commit fails. (`logAdminAction` swallows a failed
 * write, which is right for a mutation and wrong for an egress; the same
 * exception users/export.cjs makes.)
 *
 * After the first byte a failure cannot become a status code. Every error
 * then reaches one `fail`, which destroys the response instead of ending
 * it, so the browser's read of the body rejects and no cut-off zip is
 * saved as if it were whole.
 */

const { ZipFile } = require('yazl');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');

const MATERIALS = 'session_materials';
const ADMIN_LOGS = 'admin_logs';
const ARCHIVE_ACTION = 'downloadSessionMaterialsArchive';

/** Most rows one list answers. Past it the response says `truncated`. */
const MAX_LIST_ROWS = 2000;

/** Most files one archive holds. */
const MAX_ARCHIVE_FILES = 50;

/** Most bytes one archive holds, summed over its files: 200 MiB. */
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

/** The name the browser saves the archive under. Fixed ASCII: nothing a person typed reaches a header. */
const ARCHIVE_FILENAME = 'session-materials.zip';

/**
 * Most UTF-8 bytes in one folder or file name inside the archive, its
 * " (n)" and extension included. ext4 and APFS allow 255 bytes in a name
 * and NTFS 255 UTF-16 units; 240 bytes stays under both, because no
 * character takes more UTF-16 units than UTF-8 bytes. A cap in characters
 * would not: 140 CJK characters are 420 bytes.
 */
const MAX_NAME_BYTES = 240;

/** The longest ending kept as an extension when a long name is cut. */
const MAX_EXTENSION_LENGTH = 16;

const BYTES_PER_MB = 1024 * 1024;

/**
 * A Firestore Timestamp, a Date, or epoch milliseconds, as epoch
 * milliseconds; anything else as null.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/**
 * One material as the admin table reads it. `createdBy` (a uid) and
 * `createdAt` stay on the server. A file has no `url` and a link has no
 * `storagePath`, so each row carries only the address it has.
 *
 * @param {string} id
 * @param {object} data a session_materials document
 */
function listRow(id, data) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    id,
    sessionId: typeof source.sessionId === 'string' ? source.sessionId : null,
    type: source.type ?? null,
    filename: typeof source.filename === 'string' ? source.filename : '',
    reviewStatus: source.reviewStatus ?? null,
    url: source.type === 'link' && typeof source.url === 'string' ? source.url : null,
    storagePath: source.type === 'file' && typeof source.storagePath === 'string' ? source.storagePath : null,
    submittedBySpeakerId: source.submittedBySpeakerId ?? null,
    updatedAt: toMillis(source.updatedAt),
  };
}

/**
 * Validate `{ materialIds }`. Each message starts with its field, and the
 * handler joins them with '; ' so the admin client's fieldErrorsOf splits
 * them again.
 *
 * @param {unknown} body
 * @returns {{ ok: true, ids: string[] } | { ok: false, errors: string[] }}
 */
function readMaterialIds(body) {
  const ids = body && typeof body === 'object' ? body.materialIds : undefined;
  if (!Array.isArray(ids)) return { ok: false, errors: ['materialIds: must be a list of material ids.'] };
  if (ids.length === 0) return { ok: false, errors: ['materialIds: select at least one file.'] };
  if (ids.length > MAX_ARCHIVE_FILES) {
    return {
      ok: false,
      errors: [`materialIds: an archive holds at most ${MAX_ARCHIVE_FILES} files. ${ids.length} were sent.`],
    };
  }
  const errors = [];
  const seen = new Set();
  ids.forEach((id, index) => {
    if (!isValidDocId(id)) {
      errors.push(`materialIds[${index}]: must be a material id.`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`materialIds[${index}]: ${id} is listed twice.`);
      return;
    }
    seen.add(id);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, ids: [...ids] };
}

// Characters a name inside the archive never carries: the two path
// separators, control characters, and the characters a Windows extractor
// refuses in a file name. The colon is also how yazl recognises a drive
// letter (`c:`), which it refuses as an absolute path.
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARACTERS = /[/\\\u0000-\u001f\u007f-\u009f<>:"|?*]/gu;

/**
 * Split a name at its extension: the last dot, when the ending after it is
 * short and the dot is not the first character.
 *
 * @param {string} name
 * @returns {[string, string]} [base, extension with its dot, or '']
 */
function splitExtension(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > MAX_EXTENSION_LENGTH) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}

function utf8Length(text) {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Cut a base so base plus `tail` (the " (n)" and the extension) fit
 * MAX_NAME_BYTES. The cut falls between code points, so it never splits a
 * surrogate pair or a multi-byte character.
 */
function fitName(base, tail) {
  const room = MAX_NAME_BYTES - utf8Length(tail);
  let kept = '';
  let used = 0;
  for (const character of base) {
    const size = utf8Length(character);
    if (used + size > room) break;
    kept += character;
    used += size;
  }
  return `${kept || 'file'}${tail}`;
}

/**
 * One folder or file name inside the archive. The name is first composed
 * (Unicode NFC): a Mac upload stores "ä" as "a" plus a combining mark, and
 * without this the two spellings of one name pass the repeat check as two
 * names, and APFS or HFS+ then extracts one over the other. Separators,
 * control characters and the characters Windows refuses become `-`; leading dots
 * and spaces go (so `..` and `.hidden` cannot climb or hide), and so do
 * trailing dots and spaces, which Windows drops on extraction; the name is
 * cut to 240 UTF-8 bytes with its extension kept. A lone surrogate becomes
 * U+FFFD. An empty result is `file`.
 *
 * @param {unknown} part
 * @returns {string}
 */
function cleanNamePart(part) {
  const cleaned = String(part ?? '')
    .toWellFormed()
    .normalize('NFC')
    .replace(UNSAFE_NAME_CHARACTERS, '-')
    .replace(/^[.\s]+/u, '')
    .replace(/[.\s]+$/u, '');
  if (!cleaned) return 'file';
  const [base, extension] = splitExtension(cleaned);
  return fitName(base, extension);
}

/**
 * The entry name for each file, in order: `{sessionId}/{filename}`, each
 * part cleaned. A repeat name in one folder, compared without case, takes
 * ` (2)`, ` (3)` before its extension, so no entry replaces another when
 * the archive is opened.
 *
 * @param {Array<{ sessionId: string, filename: string }>} files
 * @returns {string[]}
 */
function entryNames(files) {
  const taken = new Set();
  return files.map(({ sessionId, filename }) => {
    const folder = cleanNamePart(sessionId);
    const name = cleanNamePart(filename);
    let candidate = `${folder}/${name}`;
    if (taken.has(candidate.toLowerCase())) {
      const [base, extension] = splitExtension(name);
      for (let copy = 2; ; copy += 1) {
        candidate = `${folder}/${fitName(base, ` (${copy})${extension}`)}`;
        if (!taken.has(candidate.toLowerCase())) break;
      }
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * Storage's `size` is a decimal string in the JSON API; a test fake may
 * give a number. Anything that is not a whole number of bytes is null.
 *
 * @param {unknown} raw
 * @returns {number|null}
 */
function parseSize(raw) {
  let size = NaN;
  if (typeof raw === 'number') size = raw;
  else if (typeof raw === 'string' && /^\d+$/u.test(raw.trim())) size = Number(raw.trim());
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

/** "250.3" for 262,458,573 bytes. */
function megabytes(bytes) {
  return (bytes / BYTES_PER_MB).toFixed(1);
}

function refusal(status, code, messages) {
  return { ok: false, status, code, message: messages.join('; ') };
}

function mtimeOf(data, now) {
  const ms = toMillis(data?.updatedAt);
  return new Date(ms ?? now());
}

/**
 * Everything the archive needs, checked before a byte is sent. Refuses
 * with the status the handler sends: 404 for an unknown id, 400 for a link
 * or a path outside the session's folder, 404 for a missing Storage object,
 * 500 for a size Storage did not state, and 413 when the files together
 * pass the byte limit.
 *
 * @param {{ db: object, bucket: object, ids: string[], now?: () => number }} args
 * @returns {Promise<{ ok: true, entries: Array<{ id: string, file: object, size: number, name: string, mtime: Date }> } |
 *                   { ok: false, status: number, code: string, message: string }>}
 */
async function planArchive({ db, bucket, ids, now = Date.now }) {
  const snaps = await db.getAll(...ids.map((id) => db.collection(MATERIALS).doc(id)));
  const missing = [];
  const materials = [];
  snaps.forEach((snap, index) => {
    if (snap?.exists) materials.push({ id: ids[index], data: snap.data() || {} });
    else missing.push(ids[index]);
  });
  if (missing.length > 0) {
    return refusal(404, 'not-found', missing.map((id) => `materialIds: ${id} does not exist.`));
  }

  const refused = [];
  for (const { id, data } of materials) {
    if (data.type !== 'file') {
      refused.push(`materialIds: ${id} is a link. Only files go in an archive.`);
      continue;
    }
    const prefix = typeof data.sessionId === 'string' && data.sessionId ? `session-materials/${data.sessionId}/` : null;
    const path = typeof data.storagePath === 'string' ? data.storagePath : '';
    if (!prefix || !path.startsWith(prefix) || path.length === prefix.length) {
      refused.push(`materialIds: ${id} is not stored in its session’s folder.`);
    }
  }
  if (refused.length > 0) return refusal(400, 'bad-request', refused);

  const checked = await Promise.all(materials.map(async ({ id, data }) => {
    const file = bucket.file(data.storagePath);
    const [exists] = await file.exists();
    if (!exists) return { id, data, file, exists: false };
    const [metadata] = await file.getMetadata();
    return { id, data, file, exists: true, size: parseSize(metadata?.size) };
  }));
  const label = (entry) => entry.data.filename || entry.id;

  const absent = checked.filter((entry) => !entry.exists);
  if (absent.length > 0) {
    return refusal(404, 'not-found', absent.map((entry) => `materialIds: the file for ${label(entry)} is missing from storage.`));
  }
  const unsized = checked.filter((entry) => entry.size === null);
  if (unsized.length > 0) {
    return refusal(500, 'internal', unsized.map((entry) => `materialIds: the size of ${label(entry)} could not be read.`));
  }
  const total = checked.reduce((sum, entry) => sum + entry.size, 0);
  if (total > MAX_ARCHIVE_BYTES) {
    return refusal(413, 'too-large', [
      `materialIds: the selected files come to ${megabytes(total)} MB. `
        + `An archive holds at most ${MAX_ARCHIVE_BYTES / BYTES_PER_MB} MB. Select fewer files.`,
    ]);
  }

  const names = entryNames(checked.map((entry) => ({ sessionId: entry.data.sessionId, filename: entry.data.filename })));
  return {
    ok: true,
    entries: checked.map((entry, index) => ({
      id: entry.id,
      file: entry.file,
      size: entry.size,
      name: names[index],
      mtime: mtimeOf(entry.data, now),
    })),
  };
}

/**
 * One `admin_logs` row per archived material, in the shape logAdminAction
 * writes, committed together. Throws when the commit fails.
 */
async function recordArchive({ db, entries, actor, at }) {
  const batch = db.batch();
  for (const entry of entries) {
    batch.set(db.collection(ADMIN_LOGS).doc(), {
      action: ARCHIVE_ACTION,
      docPath: `${MATERIALS}/${entry.id}`,
      uid: actor.uid,
      email: actor.email,
      at,
    });
  }
  await batch.commit();
}

/**
 * Stream the planned entries to `res` as one zip. Resolves when the
 * response finishes, fails, or the admin leaves; never rejects.
 *
 * @param {{ entries: Array<{ file: object, size: number, name: string, mtime: Date }>,
 *           res: import('express').Response, log?: Pick<Console, 'error'> }} args
 * @returns {Promise<void>}
 */
function streamArchive({ entries, res, log = console }) {
  return new Promise((resolve) => {
    // The admin may already have left; nothing is read for a closed response.
    if (responseClosed(res)) {
      resolve();
      return;
    }
    const zip = new ZipFile();
    let current = null;
    let settled = false;

    const settle = () => {
      if (settled) return false;
      settled = true;
      resolve();
      return true;
    };
    const stopReading = () => {
      zip.outputStream.unpipe(res);
      current?.destroy();
      current = null;
    };
    // One place for every failure after the first byte. It never ends the
    // response: an ended response is a whole file to the browser.
    const fail = (err) => {
      if (!settle()) return;
      log.error('downloadSessionMaterialsArchive: the archive stopped before it finished', err);
      stopReading();
      res.destroy(err);
    };

    zip.on('error', fail);
    zip.outputStream.on('error', fail);
    res.on('finish', settle);
    res.on('close', () => {
      // A close before finish is the admin leaving: stop reading Storage.
      if (settle()) stopReading();
    });

    for (const entry of entries) {
      zip.addReadStreamLazy(entry.name, { compress: false, size: entry.size, mtime: entry.mtime }, (callback) => {
        // Once the archive has settled (failed, or the admin left), the next
        // entry opens no Storage read.
        if (settled) {
          callback(new Error('the archive has stopped'));
          return;
        }
        const stream = entry.file.createReadStream();
        current = stream;
        // yazl listens for errors only on the streams it opens itself.
        stream.on('error', fail);
        stream.on('end', () => {
          if (current === stream) current = null;
        });
        callback(null, stream);
      });
    }
    zip.end();

    res.status(200);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${ARCHIVE_FILENAME}"`);
    res.set('Cache-Control', 'private, max-age=0, no-store');
    zip.outputStream.pipe(res);
  });
}

/**
 * Whether the response can no longer reach the admin: they closed the tab
 * or the network dropped. The server sets `destroyed` when the connection
 * closes before the response ends.
 */
function responseClosed(res) {
  return res?.destroyed === true || res?.writableEnded === true;
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           log?: Pick<Console, 'error'> }} deps
 */
function createListAllSessionMaterialsHandler({ db, auth, getConfig, log = console }) {
  return async function listAllSessionMaterials(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    let snap;
    try {
      // One row past the cap says whether the list was cut.
      snap = await db.collection(MATERIALS).limit(MAX_LIST_ROWS + 1).get();
    } catch (err) {
      log.error('listAllSessionMaterials failed', err);
      return internal(res, 'Materials could not be listed.');
    }
    const docs = snap.docs.slice(0, MAX_LIST_ROWS);
    res.set('Cache-Control', 'private, max-age=0, no-store');
    return res.status(200).json({
      materials: docs.map((doc) => listRow(doc.id, doc.data())),
      truncated: snap.docs.length > MAX_LIST_ROWS,
    });
  };
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           bucket: object | (() => object), now?: () => number,
 *           log?: Pick<Console, 'error'> }} deps
 */
function createDownloadSessionMaterialsArchiveHandler({ db, auth, getConfig, bucket, now = Date.now, log = console }) {
  return async function downloadSessionMaterialsArchive(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    // Watched from the first line: the checks and the audit commit below can
    // take seconds, and an admin who leaves in that time must not start a
    // Storage read that nothing will ever drain.
    let left = false;
    res.on?.('close', () => {
      left = true;
    });
    const gone = () => left || responseClosed(res);

    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const request = readMaterialIds(req.body);
    if (!request.ok) return badRequest(res, request.errors.join('; '));

    let plan;
    try {
      plan = await planArchive({ db, bucket: typeof bucket === 'function' ? bucket() : bucket, ids: request.ids, now });
    } catch (err) {
      log.error('downloadSessionMaterialsArchive: the files could not be checked', err);
      return internal(res, 'The archive could not be prepared. Try again.');
    }
    if (!plan.ok) return sendError(res, plan.status, plan.code, plan.message);
    if (gone()) {
      log.info?.('downloadSessionMaterialsArchive: the admin left before the archive was recorded');
      return;
    }

    try {
      await recordArchive({ db, entries: plan.entries, actor: gate, at: new Date(now()) });
    } catch (err) {
      log.error('downloadSessionMaterialsArchive: the admin_logs rows could not be written; nothing was sent', err);
      return internal(res, 'The archive could not be recorded, so it was not built.');
    }
    if (gone()) {
      log.info?.('downloadSessionMaterialsArchive: the admin left before the archive was built');
      return;
    }

    await streamArchive({ entries: plan.entries, res, log });
  };
}

/** Deployable exports: listAllSessionMaterials, downloadSessionMaterialsArchive. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return {
      db,
      auth: getAuth(),
      getConfig: () => getEventConfig({ db }),
      // The bucket downloadSessionMaterial reads, so a file downloads from
      // the same place alone and in an archive. getDb() above has made the
      // default app this needs.
      bucket: () => require('firebase-admin/storage').getStorage().bucket(),
    };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    listAllSessionMaterials: onRequest({ region }, withCors(async (req, res) => {
      await createListAllSessionMaterialsHandler(buildDeps())(req, res);
    })),
    // 540 s: at the byte cap that is about 3.1 Mbit/s to the admin.
    downloadSessionMaterialsArchive: onRequest({ region, timeoutSeconds: 540 }, withCors(async (req, res) => {
      await createDownloadSessionMaterialsArchiveHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  createListAllSessionMaterialsHandler,
  createDownloadSessionMaterialsArchiveHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    MAX_LIST_ROWS,
    MAX_ARCHIVE_FILES,
    MAX_ARCHIVE_BYTES,
    ARCHIVE_FILENAME,
    ARCHIVE_ACTION,
    MAX_NAME_BYTES,
    listRow,
    readMaterialIds,
    cleanNamePart,
    entryNames,
    parseSize,
    planArchive,
    recordArchive,
    streamArchive,
  },
};
