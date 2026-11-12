// Words and formatters for the version history pages (issue #195).
//
// A version is one row functions/src/cms/store.cjs publishDocs appends to
// cmsVersionHistory each time a record is published. The server compares
// each row with the one before it (functions/src/cms/versions.cjs
// describeChanges) and answers a list of changed paths; pages/versionDisplay.js
// turns those into words. This module holds the collection choices, the
// time formatters and the restore request. Nothing here builds markup.
//
// The lazy version pages use this module; other lazy admin pages share its
// timestamp readers and formatters. It stays out of the admin entry chunk
// (scripts/ci/bundle-budget.json).
import { zoneLabel } from '../lib/eventTime.js';
import { DELETE_FIELD_SENTINEL } from './contentDoc.js';
import { COLLECTION_CHOICES } from './collectionWords.js';

/**
 * The six publishable collections and their words, from the one list the
 * unpublished changes page and its banner read (collectionWords.js, issue
 * #196), so the two pages cannot name a collection two ways.
 */
export { COLLECTION_CHOICES };

/** The collection the list opens on when the URL names none it knows. */
export const DEFAULT_COLLECTION = 'cmsContent';

/** Newest saved version for each record absent from both live and drafts. */
export function removedVersionRecords(collection, versions, currentRows) {
  const current = new Set(currentRows.filter((row) => row.current).map((row) => row.id));
  const latest = new Map();
  const prefix = `${collection}/`;
  for (const entry of versions) {
    if (typeof entry.docPath !== 'string' || !entry.docPath.startsWith(prefix)) continue;
    const id = entry.docPath.slice(prefix.length);
    if (!id || id.includes('/') || current.has(id)) continue;
    if (!latest.has(id) || entry.revision > latest.get(id).revision) latest.set(id, { ...entry, id });
  }
  return [...latest.values()];
}

/**
 * The choice for a collection id, or null. A find over the list rather than
 * a lookup in a map, so a URL that says "constructor" finds nothing.
 *
 * @param {unknown} id
 */
export function collectionChoice(id) {
  return COLLECTION_CHOICES.find((choice) => choice.id === id) ?? null;
}

const DISPLAY_LOCALE = 'en-US';
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Milliseconds from a Date, a Firestore Timestamp (anything with
 * `toMillis()`), or a number; null for anything else.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function toMillis(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value?.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return null;
}

/**
 * A Date from a Firestore Timestamp (anything with `toDate()`), a Date, a
 * number or an ISO string; null for anything else.
 *
 * @param {unknown} value
 * @returns {Date|null}
 */
export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Intl in the event's zone, or in the reader's own when the event states
 * none or states one Intl refuses. Returns the zone it used.
 */
function formatIn(timeZone, instant, options) {
  if (timeZone) {
    try {
      return { text: new Intl.DateTimeFormat(DISPLAY_LOCALE, { ...options, timeZone }).format(instant), zone: timeZone };
    } catch {
      // An unknown zone: fall through to the reader's clock.
    }
  }
  return { text: new Intl.DateTimeFormat(DISPLAY_LOCALE, options).format(instant), zone: undefined };
}

function withZone({ text, zone }, instant) {
  const label = zoneLabel(zone, instant);
  return label ? `${text} ${label}` : text;
}

/**
 * "Sep 23, 2026, 2:02 PM EDT": the date and time on the event's clock, with
 * the zone named, so a reader in another zone is never left to guess.
 *
 * @param {unknown} value milliseconds, a Date, or a Timestamp
 * @param {string} [timeZone] the event's IANA zone
 * @returns {string|null}
 */
export function formatPublishedAt(value, timeZone) {
  const ms = toMillis(value);
  if (ms === null) return null;
  const instant = new Date(ms);
  return withZone(formatIn(timeZone, instant, { dateStyle: 'medium', timeStyle: 'short' }), instant);
}

/** "2:14 PM EDT": the time of day on the event's clock. */
export function formatClock(value, timeZone) {
  const ms = toMillis(value);
  if (ms === null) return null;
  const instant = new Date(ms);
  return withZone(formatIn(timeZone, instant, { hour: 'numeric', minute: '2-digit' }), instant);
}

/** Publish-model and listener bookkeeping that never belongs to content. */
const NOT_CONTENT = Object.freeze([
  'id',
  'visible',
  'status',
  'revision',
  'basedOnRevision',
  'updatedAt',
  'updatedBy',
  'publishedAt',
  'publishedBy',
  'materialCount',
]);

/** Seed bookkeeping is removed by every normal editor save. */
const SEED_FIELDS = Object.freeze(['seeded', 'seededAt']);
// The timeline save seam drops stored-only legacy fields and rejects them
// in a request. Restore only the same three fields its normal editor sends.
const TIMELINE_FIELDS = Object.freeze(['year', 'title', 'description']);

function withoutSeedFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!SEED_FIELDS.includes(key)) out[key] = value;
  }
  return out;
}

/** The current page that owns a content section, or null. */
export function pageIdForSection(rows, sectionId) {
  if (!nonEmpty(sectionId)) return null;
  const owner = (rows ?? []).find((page) =>
    Array.isArray(page?.current?.sections) && page.current.sections.some((section) => section?.id === sectionId));
  return owner?.id ?? null;
}

/**
 * Build the ordinary editor save that makes a published version a draft.
 * Generic updates merge fields, so current-only content fields are sent as
 * deletions. A deleted content block also needs its owning page id because
 * cmsCreateContent enforces that page's section rules atomically.
 */
export function restoreRequestFor(collection, docId, entry, current, { pageId = null } = {}) {
  const snapshot = withoutSeedFields(entry?.fields);
  const fields = collection === 'cmsTimeline'
    ? Object.fromEntries(Object.entries(snapshot).filter(([key]) => TIMELINE_FIELDS.includes(key)))
    : snapshot;
  const visible = entry?.visible !== false;
  if (collection === 'cmsPages') {
    return { endpoint: 'cmsSavePage', body: { page: { ...fields, id: docId, visible }, ...(!current ? { create: true } : {}) } };
  }
  if (collection === 'cmsUpdates') {
    // A deleted update has a tombstone. restore tells the save to clear
    // it and write the draft. An update that is still there is an ordinary
    // save, and that save must not carry the flag.
    const body = { id: docId, update: fields, visible };
    if (!current) body.restore = true;
    return { endpoint: 'cmsSaveUpdate', body };
  }

  let target;
  if (collection === 'cmsContent') {
    const { section, field } = fields;
    if (!nonEmpty(section) || !nonEmpty(field) || `${section}__${field}` !== docId) return null;
    target = { section, field };
  } else {
    target = { docId };
  }

  if (!current) {
    if (collection === 'cmsContent' && !nonEmpty(pageId)) return null;
    return {
      endpoint: 'cmsCreateContent',
      body: { collection, ...target, ...(collection === 'cmsContent' ? { pageId } : {}), fields, visible },
    };
  }

  const cleared = {};
  for (const key of Object.keys(current)) {
    if (NOT_CONTENT.includes(key) || SEED_FIELDS.includes(key)) continue;
    if (collection === 'cmsTimeline' && !TIMELINE_FIELDS.includes(key)) continue;
    if (!Object.hasOwn(fields, key)) cleared[key] = DELETE_FIELD_SENTINEL;
  }
  return {
    endpoint: 'cmsUpdateContent',
    body: { collection, ...target, fields: { ...fields, ...cleared }, visible },
  };
}
