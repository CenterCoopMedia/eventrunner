// cmsUpdates document helpers shared by the updates list and the update
// editor (issue #190).
//
// The server (functions/src/cms/updates.cjs validateUpdateDoc) refuses any
// key outside its allowlist BY NAME, and a stored doc carries keys it will
// not take back: the publish model's bookkeeping (visible, status,
// revision, updatedAt, …) and the seed's (seeded, seededAt). So the payload
// is built from named keys, never by spreading the stored doc.
//
// THE DATE IS A DAY ON THE EVENT'S CLOCK. `publishAt` is display scheduling:
// the date readers see on the Updates page and in the update's dateline,
// which a3's dateline formats in config/event.timezone. It never gates the
// publish action. The editor shows it as a day in that zone, and a save
// keeps the stored instant when the day did not change, so opening and
// saving an update never moves its date. A changed day is stored at noon on
// the event's clock, which reads as the same day on the event's clock and,
// with no zone configured, as noon UTC.
import { validUpdateCategory } from 'shared/update';
import { zonedDateTime } from '../lib/eventTime.js';
import { compareUpdates, toPublishDate } from '../lib/updateDates.js';
import { recordStateOf } from './recordState.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const UPDATES_ROOT = '/admin/updates';
// Not `updates/new`: `new` is a valid update id (the server takes
// `^[A-Za-z0-9_-]{1,64}$`), and its edit route would always open the create
// form instead. The sessions editor sits at sessions/new/session for the
// same reason.
export const NEW_UPDATE_PATH = `${UPDATES_ROOT}/new/update`;

/** Said on the list and the editor while config/features.updates is off. */
export const UPDATES_OFF_MESSAGE =
  'Updates are off for this event, so the site does not show them. An operator can turn them on under Features.';

/**
 * The parts of `instant` on the event's clock, or on the reader's when no
 * zone is given or the runtime does not know it (the fallback the public
 * dateline takes, lib/updateDates.js).
 */
function dayPartsIn(instant, timeZone) {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
  let format = null;
  if (typeof timeZone === 'string' && timeZone) {
    try {
      format = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    } catch {
      format = null;
    }
  }
  format ??= new Intl.DateTimeFormat('en-US', options);
  const parts = {};
  for (const part of format.formatToParts(instant)) parts[part.type] = part.value;
  return parts;
}

/**
 * "YYYY-MM-DD" for a stored publishAt on the event's clock, or '' for an
 * undated update. This is the value a `type="date"` control carries.
 *
 * @param {*} publishAt Firestore Timestamp | Date | ISO string | null
 * @param {string} [timeZone] config/event.timezone
 * @returns {string}
 */
export function dayInZone(publishAt, timeZone) {
  const instant = toPublishDate(publishAt);
  if (!instant) return '';
  const { year, month, day } = dayPartsIn(instant, timeZone);
  return `${year}-${month}-${day}`;
}

/**
 * The publishAt a save sends for the day in the form.
 *
 * Blank is undated (null). The stored day, unchanged, sends the stored
 * instant back, so a save never moves a date it did not touch. A changed
 * day is noon on the event's clock, or noon UTC when the event has no zone
 * or one the runtime does not know.
 *
 * @param {string} day "YYYY-MM-DD" or ''
 * @param {*} stored the record's current publishAt
 * @param {string} [timeZone]
 * @returns {string|null} an ISO instant, or null
 */
export function publishAtFor(day, stored, timeZone) {
  if (!day) return null;
  const storedInstant = toPublishDate(stored);
  if (storedInstant && dayInZone(storedInstant, timeZone) === day) return storedInstant.toISOString();
  const noon = zonedDateTime(day, '12:00', timeZone);
  if (noon) return noon.toISOString();
  // No zone, or one the runtime does not know. A value that is not a day
  // at all goes to the server as it is, and the server names the field.
  return DAY_RE.test(day) ? `${day}T12:00:00.000Z` : day;
}

/**
 * Where an update sits in the public feed, in words. A featured update may
 * lead the page (issue #191): the first one in the feed's order does.
 */
export function placementOf(update) {
  const pinned = update?.pinned === true;
  if (update?.featured === true) return pinned ? 'Featured and pinned' : 'Featured';
  return pinned ? 'Pinned' : 'By date';
}

/** An update's category as the public page shows it, or null for none. */
export function categoryOf(update) {
  return validUpdateCategory(update?.category) ? update.category.trim() : null;
}

/**
 * The categories the updates already use, once each and in order, for the
 * editor's suggestions, so one topic is spelt one way.
 *
 * @param {Array<{ current?: object }>} rows
 * @returns {string[]}
 */
export function categoriesIn(rows) {
  const seen = new Set();
  for (const row of rows ?? []) {
    const category = categoryOf(row?.current);
    if (category) seen.add(category);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** The form a new update starts from. It is shown when published. */
export function blankUpdateForm() {
  return {
    title: '',
    body: '',
    date: '',
    category: '',
    pinned: false,
    featured: false,
    visible: true,
  };
}

/**
 * Editable form state from a merged row (its draft if it has one, else its
 * live doc).
 *
 * @param {{ current?: object }|null} row
 * @param {string} [timeZone]
 */
export function toUpdateForm(row, timeZone) {
  const current = row?.current ?? {};
  return {
    title: typeof current.title === 'string' ? current.title : '',
    body: typeof current.body === 'string' ? current.body : '',
    date: dayInZone(current.publishAt, timeZone),
    category: typeof current.category === 'string' ? current.category : '',
    pinned: current.pinned === true,
    featured: current.featured === true,
    visible: current.visible !== false,
  };
}

/**
 * The `update` object cmsSaveUpdate takes, from named keys only. The
 * picture and the content blocks this editor does not edit come back from
 * the stored record unchanged, so a save here never drops them.
 *
 * @param {object} form
 * @param {{ current?: object }|null} row null for a new update
 * @param {string} [timeZone]
 */
export function toUpdatePayload(form, row, timeZone) {
  const current = row?.current ?? {};
  const payload = {
    title: String(form.title ?? '').trim(),
    body: String(form.body ?? '').trim(),
    publishAt: publishAtFor(form.date, current.publishAt, timeZone),
    pinned: form.pinned === true,
    category: String(form.category ?? '').trim() || null,
    featured: form.featured === true,
  };
  if (current.featuredImage !== undefined) payload.featuredImage = current.featuredImage;
  if (current.content !== undefined) payload.content = current.content;
  return payload;
}

/**
 * What the record carries that this editor keeps but does not edit: its
 * picture and its content blocks.
 *
 * @param {{ current?: object }|null} row
 * @returns {{ picture: boolean, blocks: number }}
 */
export function extrasOf(row) {
  const current = row?.current ?? {};
  return {
    picture: current.featuredImage != null,
    blocks: Array.isArray(current.content) ? current.content.length : 0,
  };
}

/**
 * Merge live and draft cmsUpdates docs into one row per update, in the
 * public feed's order (pinned first, then newest first, undated last),
 * with the id as the tie-break so the order is stable.
 *
 * @param {Array<object>|null} live
 * @param {Array<object>|null} drafts
 * @returns {Array<{ id: string, live: object|null, draft: object|null,
 *                   current: object, state: { id: string, label: string } }>}
 */
export function mergeUpdateRevisions(live, drafts) {
  const rows = new Map();
  for (const doc of live ?? []) rows.set(doc.id, { id: doc.id, live: doc, draft: null });
  for (const doc of drafts ?? []) {
    const existing = rows.get(doc.id) ?? { id: doc.id, live: null, draft: null };
    rows.set(doc.id, { ...existing, draft: doc });
  }
  return [...rows.values()]
    .map((row) => ({ ...row, current: row.draft ?? row.live, state: recordStateOf(row) }))
    .sort((a, b) => compareUpdates(a.current, b.current) || String(a.id).localeCompare(String(b.id)));
}

/**
 * The ids a "Publish all" sends: every update whose draft is dirty, the
 * same predicate the server's dirty-draft listing reads (store.cjs
 * listDirty), so the count here and any count of unpublished work agree.
 *
 * @param {Array<{ id: string, draft: object|null }>} rows
 * @returns {string[]}
 */
export function dirtyUpdateIds(rows) {
  return rows.filter((row) => row.draft?.status === 'dirty').map((row) => row.id);
}
