// Words and formatters for the version history pages (issue #195).
//
// A version is one row functions/src/cms/store.cjs publishDocs appends to
// cmsVersionHistory each time a record is published. The server compares
// each row with the one before it (functions/src/cms/versions.cjs
// describeChanges) and answers a list of changed paths; this module turns
// those paths and values into the words the page shows. Every value is
// text: nothing here builds markup, and a stored URL stays a string.
//
// It is imported by the two lazy version pages only, so none of it rides in
// the admin entry chunk (scripts/ci/bundle-budget.json).
import { zoneLabel } from '../lib/eventTime.js';
import { COLLECTION_CHOICES } from './collectionWords.js';

/**
 * The six publishable collections and their words, from the one list the
 * unpublished changes page and its banner read (collectionWords.js, issue
 * #196), so the two pages cannot name a collection two ways.
 */
export { COLLECTION_CHOICES };

/** The collection the list opens on when the URL names none it knows. */
export const DEFAULT_COLLECTION = 'cmsContent';

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
const NAME_FIELDS = Object.freeze(['title', 'name', 'label', 'question']);
export const MAX_NAME_LENGTH = 80;

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

/** A name cut to MAX_NAME_LENGTH characters, the last one an ellipsis. */
function cut(text) {
  const trimmed = text.trim();
  return trimmed.length > MAX_NAME_LENGTH ? `${trimmed.slice(0, MAX_NAME_LENGTH - 1)}…` : trimmed;
}

/**
 * The name a record goes by in a list: its title, name, label or question,
 * the first one that holds text; for a content block, then its section and
 * field; else its id.
 *
 * @param {string} collection
 * @param {object|null} doc a live or draft document, `{ id, ...fields }`
 * @returns {string}
 */
export function recordNameOf(collection, doc) {
  for (const key of NAME_FIELDS) {
    if (nonEmpty(doc?.[key])) return cut(doc[key]);
  }
  if (collection === 'cmsContent' && nonEmpty(doc?.section) && nonEmpty(doc?.field)) {
    return cut(`${doc.section} › ${doc.field}`);
  }
  return cut(String(doc?.id ?? ''));
}

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

const isScalar = (value) => value === null || value === undefined || typeof value !== 'object';

/**
 * One stored value as words. A value in a change the server marked as a
 * time (`publishAt`) is an instant in milliseconds, and reads as a date.
 *
 * @param {unknown} value
 * @param {{ time?: boolean, timeZone?: string }} [options]
 * @returns {string}
 */
export function valueText(value, { time = false, timeZone } = {}) {
  if (value === null || value === undefined) return 'Not set';
  if (time) {
    const formatted = formatPublishedAt(value, timeZone);
    if (formatted) return formatted;
  }
  if (value === '') return 'Empty';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    if (value.every(isScalar)) return value.map((item) => (item === null || item === undefined ? 'Not set' : String(item))).join(', ');
  } else if (typeof value === 'object' && Object.keys(value).length === 0) {
    return 'None';
  }
  return JSON.stringify(value);
}

/**
 * A changed path as words: segments joined by " › ", an index counted from
 * one ("sections › item 2 › label"). `visible` is the publish model's own
 * flag and reads as what it does.
 *
 * @param {string} path
 * @returns {string}
 */
export function pathText(path) {
  if (path === 'visible') return 'Shown on the site';
  return String(path)
    .split('.')
    .map((segment) => (/^\d+$/.test(segment) ? `item ${Number(segment) + 1}` : segment))
    .join(' › ');
}
