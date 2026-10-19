'use strict';

/**
 * The record shapes the event data exports write (issue #329): the staff and
 * operator spreadsheets (dataExport.cjs) and the operator's event data
 * package (eventPackage.cjs). One file, so a spreadsheet and the package
 * never disagree about what leaves the deployment.
 *
 * TWO KINDS OF COLLECTION.
 *
 *   1. Private collections (speakers, users, session_pitches,
 *      session_materials, ticket_orders, tickets, media_assets). Each has an
 *      explicit record function below that names every field it copies. A
 *      field added to one of these documents later stays private until it is
 *      added here, the same rule users/export.cjs applies to attendees.
 *   2. Public-by-design collections (the live CMS documents and the public
 *      config documents). Anybody can read a shown one already, so the
 *      record is the stored document, with timestamps as ISO strings and
 *      the bookkeeping keys (`updatedBy`, `publishedBy` and the like)
 *      removed. A hidden live document (visible: false) is admin-only; its
 *      record keeps `visible`, so a reader can tell. Drafts are never read
 *      into a package.
 *
 * Both kinds then pass through `scrub`, which removes any key that names a
 * credential (a token, a secret, a password, a key, a signature) or a raw
 * provider payload, at any depth. Nothing below should carry one; the scrub
 * is the second check, so a mistake in a record function still cannot ship
 * a credential.
 *
 * Pure: no db, no clock. The readers at the end take a db.
 */

/** Keys removed at every depth of every exported record. */
const SECRET_KEY_RE = /^(?:raw|rawPayload|payload|stripeRequest|idempotencyKey|checkoutUrl)$|token(?!s$)|secret|password|passcode|apikey|api_key|privatekey|private_key|credential|signature/i;

/** Bookkeeping keys that name a staff account or the publish model, not content. */
const BOOKKEEPING_KEYS = Object.freeze([
  'updatedBy', 'publishedBy', 'createdBy', 'basedOnRevision', 'seeded',
]);

/** Firestore reads at most this many documents per page. */
const PAGE_SIZE = 300;

/** Joins the entries of a list cell or a list field in a spreadsheet. */
const LIST_SEPARATOR = '; ';

/**
 * A Firestore Timestamp, a Date, or an ISO string, as an ISO string; else null.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function toIso(value) {
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string' && value) return value;
  return null;
}

/** @param {unknown} value @returns {string} */
function text(value) {
  return typeof value === 'string' ? value : '';
}

/** @param {unknown} value @returns {string|null} */
function textOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** @param {unknown} value @returns {number|null} */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value @returns {string[]} */
function textList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()) : [];
}

/** @param {unknown} value @returns {Record<string, string>} */
function handles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [label, handle] of Object.entries(value)) {
    if (typeof label === 'string' && label && typeof handle === 'string' && handle.trim()) out[label] = handle;
  }
  return out;
}

/** True for a key `scrub` removes. */
function isSecretKey(key) {
  return SECRET_KEY_RE.test(key);
}

/**
 * A JSON-safe deep copy: timestamps become ISO strings, functions and
 * undefined drop out, and every secret-named key is removed at every depth.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function scrub(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'function') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return value;
  if (typeof value.toDate === 'function' || value instanceof Date) return toIso(value);
  // A GeoPoint or a DocumentReference: keep what it points at, not the object.
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (typeof value.path === 'string' && typeof value.id === 'string' && typeof value.get === 'function') {
    return value.path;
  }
  if (Array.isArray(value)) return value.map(scrub).filter((entry) => entry !== undefined);
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSecretKey(key)) continue;
    const copied = scrub(entry);
    if (copied !== undefined) out[key] = copied;
  }
  return out;
}

/**
 * A public-by-design document: the stored fields, scrubbed, without the
 * publish bookkeeping. The id leads so a reader can join on it.
 *
 * @param {string} id
 * @param {object} data
 */
function publicRecord(id, data) {
  const source = data && typeof data === 'object' ? { ...data } : {};
  for (const key of BOOKKEEPING_KEYS) delete source[key];
  delete source.id;
  return { id, ...scrub(source) };
}

/** A live cmsSchedule document. Public by design; the record names the joins. */
function sessionRecord(id, data) {
  const record = publicRecord(id, data);
  record.speakerIds = textList(data?.speakerIds);
  record.parentId = textOrNull(data?.parentId);
  record.dayId = textOrNull(data?.dayId);
  return record;
}

/**
 * A speakers document. No account id, no invite token or its hash, no
 * accepting address, no staged edits, no invite send budget.
 */
function speakerRecord(id, data) {
  const source = data && typeof data === 'object' ? data : {};
  return scrub({
    id,
    firstName: text(source.firstName),
    lastName: text(source.lastName),
    slug: text(source.slug),
    email: text(source.email),
    organization: text(source.organization),
    jobTitle: text(source.jobTitle),
    bio: text(source.bio),
    headshotPath: textOrNull(source.headshotPath),
    socialHandles: handles(source.socialHandles),
    status: text(source.status),
    approvedAt: toIso(source.approvedAt),
    createdAt: toIso(source.createdAt),
    updatedAt: toIso(source.updatedAt),
  });
}

/** A live cmsOrganizations document. */
function organizationRecord(id, data) {
  return publicRecord(id, data);
}

/**
 * A users document: the attendee export's approved fields (users/export.cjs)
 * plus the account id, so tickets and pitches can join on it. No pronouns,
 * bio, photo path, approval source, or access role.
 */
function attendeeRecord(id, data) {
  const source = data && typeof data === 'object' ? data : {};
  return scrub({
    id,
    displayName: text(source.displayName),
    email: text(source.email),
    organization: text(source.organization),
    jobTitle: text(source.jobTitle),
    registrationStatus: text(source.registrationStatus),
    badges: textList(source.badges),
    customBadges: textList(source.customBadges),
    pastAttendance: textList(source.pastAttendance),
    socialHandles: handles(source.socialHandles),
    profileVisibility: text(source.profileVisibility),
    speakerId: textOrNull(source.speakerId),
    createdAt: toIso(source.createdAt),
  });
}

/**
 * A session_pitches document with its review state. Staff notes go only
 * when the operator asks for them; the reviewer's and converter's
 * addresses never go.
 *
 * convertSessionPitch (sessions/pitchQueue.cjs) stores
 * `conversion: { sessionId, speakerId, revision }` and `convertedAt`. The
 * record names the session and the speaker the pitch became.
 */
function pitchRecord(id, data, { includeStaffNotes = false } = {}) {
  const source = data && typeof data === 'object' ? data : {};
  const record = {
    id,
    source: text(source.source) || 'form',
    externalId: textOrNull(source.externalId),
    submitterAccountId: textOrNull(source.uid),
    email: text(source.email),
    title: text(source.title),
    description: text(source.description),
    organization: text(source.organization),
    format: text(source.format),
    consentVersion: textOrNull(source.consent?.version),
    consentAt: toIso(source.consent?.at),
    status: text(source.status),
    reviewRevision: numberOrNull(source.reviewRevision) ?? 0,
    reviewedAt: toIso(source.reviewedAt),
    convertedSessionId: textOrNull(source.conversion?.sessionId),
    convertedSpeakerId: textOrNull(source.conversion?.speakerId),
    convertedAt: toIso(source.convertedAt),
    createdAt: toIso(source.createdAt),
  };
  if (includeStaffNotes) record.staffNotes = textOrNull(source.privateNotes);
  return scrub(record);
}

/**
 * A session_materials document: what it is, where it lives, and its review
 * state. A file names its Storage path; a link names its address.
 */
function materialRecord(id, data) {
  const source = data && typeof data === 'object' ? data : {};
  return scrub({
    id,
    sessionId: textOrNull(source.sessionId),
    type: text(source.type),
    filename: text(source.filename),
    url: source.type === 'link' ? textOrNull(source.url) : null,
    storagePath: source.type === 'file' ? textOrNull(source.storagePath) : null,
    reviewStatus: text(source.reviewStatus),
    submittedBySpeakerId: textOrNull(source.submittedBySpeakerId),
    createdAt: toIso(source.createdAt),
    updatedAt: toIso(source.updatedAt),
  });
}

/** A media_assets document: the library's index of uploaded files. */
function mediaRecord(id, data) {
  const source = data && typeof data === 'object' ? data : {};
  // No uploader address or account id: the library row names a staff
  // member, and the handoff is about the file.
  return scrub({
    id,
    path: textOrNull(source.path),
    folder: textOrNull(source.folder),
    filename: text(source.filename),
    contentType: textOrNull(source.contentType),
    size: numberOrNull(source.size),
    alt: text(source.alt),
    title: text(source.title),
    createdAt: toIso(source.createdAt),
    updatedAt: toIso(source.updatedAt),
  });
}

/**
 * Order amounts are stored in the currency's minor unit. The record keeps
 * the stored integers and the exponent, so a reader can recompute.
 */
function orderRecord(id, data) {
  const source = data && typeof data === 'object' ? data : {};
  const lines = Array.isArray(source.lines) ? source.lines : [];
  return scrub({
    id,
    provider: text(source.provider),
    mode: source.livemode === true ? 'live' : source.livemode === false ? 'test' : null,
    source: text(source.source) || 'checkout',
    status: text(source.status),
    paymentStatus: text(source.paymentStatus),
    purchaserAccountId: textOrNull(source.purchaserUid),
    purchaserEmail: text(source.purchaserEmail),
    currency: text(source.currency),
    currencyExponent: numberOrNull(source.currencyExponent) ?? 2,
    subtotalAmount: numberOrNull(source.subtotalAmount),
    discountAmount: numberOrNull(source.discountAmount) ?? 0,
    taxAmount: numberOrNull(source.taxAmount) ?? 0,
    feeAmount: numberOrNull(source.feeAmount) ?? 0,
    totalAmount: numberOrNull(source.totalAmount),
    refundStatus: text(source.refundStatus) || 'none',
    refundedAmount: numberOrNull(source.refundedAmount) ?? 0,
    lines: lines.map((line) => ({
      ticketTypeId: text(line?.ticketTypeId),
      name: text(line?.name),
      quantity: numberOrNull(line?.quantity) ?? 0,
      unitAmount: numberOrNull(line?.unitAmount),
      lineAmount: numberOrNull(line?.lineAmount),
    })),
    ticketIds: textList(source.ticketIds),
    compReason: textOrNull(source.compReason),
    createdAt: toIso(source.createdAt),
    updatedAt: toIso(source.updatedAt),
  });
}

/** A tickets document: one admission. No raw provider record. */
function admissionRecord(id, data) {
  const source = data && typeof data === 'object' ? data : {};
  return scrub({
    id,
    orderId: textOrNull(source.orderId),
    provider: text(source.provider),
    ticketTypeId: textOrNull(source.ticketTypeId),
    ticketClass: text(source.ticketClass),
    firstName: text(source.firstName),
    lastName: text(source.lastName),
    email: text(source.email),
    quantity: numberOrNull(source.quantity) ?? 1,
    status: text(source.status),
    claimedByAccountId: textOrNull(source.claimedByUid),
    claimedAt: toIso(source.claimedAt),
    checkedInAt: toIso(source.checkedInAt),
    purchasedAt: toIso(source.purchasedAt),
    createdAt: toIso(source.createdAt),
  });
}

/**
 * Read a whole collection a page at a time, in document id order, and hand
 * each page to `onPage`. Stops with `LimitError` once `maxDocs` would pass,
 * so a run never holds an unbounded collection.
 *
 * @param {{ db: object, collection: string, pageSize?: number, maxDocs?: number,
 *           counter?: { read: number } }} args
 * @param {(docs: Array<{ id: string, data: object }>) => void} onPage
 * @returns {Promise<number>} the documents read
 */
async function readPages({ db, collection, pageSize = PAGE_SIZE, maxDocs = Infinity, counter = { read: 0 } }, onPage) {
  let cursor;
  let total = 0;
  for (;;) {
    let query = db.collection(collection).orderBy('__name__').limit(pageSize);
    if (cursor !== undefined) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.docs.length === 0) break;
    counter.read += snap.docs.length;
    if (counter.read > maxDocs) throw new LimitError(maxDocs);
    total += snap.docs.length;
    onPage(snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })));
    if (snap.docs.length < pageSize) break;
    cursor = snap.docs[snap.docs.length - 1].id;
  }
  return total;
}

/**
 * Every document of a collection, mapped through `toRecord`, in id order.
 *
 * @param {{ db: object, collection: string, pageSize?: number, maxDocs?: number,
 *           counter?: { read: number } }} args
 * @param {(id: string, data: object) => object} toRecord
 * @returns {Promise<object[]>}
 */
async function readRecords(args, toRecord) {
  const records = [];
  await readPages(args, (docs) => {
    for (const { id, data } of docs) records.push(toRecord(id, data));
  });
  return records;
}

/** A read passed its document limit. */
class LimitError extends Error {
  constructor(maxDocs) {
    super(`the export would read more than ${maxDocs} documents`);
    this.name = 'LimitError';
    this.maxDocs = maxDocs;
  }
}

module.exports = {
  LIST_SEPARATOR,
  PAGE_SIZE,
  LimitError,
  admissionRecord,
  attendeeRecord,
  handles,
  isSecretKey,
  materialRecord,
  mediaRecord,
  orderRecord,
  organizationRecord,
  pitchRecord,
  publicRecord,
  readPages,
  readRecords,
  scrub,
  sessionRecord,
  speakerRecord,
  text,
  textList,
  toIso,
};
