// The Unpublished changes page's pure helpers (issue #196). Imported by the
// lazy page only, so none of this rides in the admin entry chunk.
//
// The rows come from the shell's one count (PendingChangesContext): the
// dirty drafts of each publishable collection. The runs are the
// cmsPublishQueue rows cmsPublish writes (functions/src/cms/publish.cjs),
// read as the progress and failure record beside them.
import { zoneLabel } from '../lib/eventTime.js';
import { COLLECTION_CHOICES } from './collectionWords.js';
import { summarizePublish } from './publishResult.js';
import { state } from './recordState.js';
import { sectionTier } from './AdminLayout.jsx';

/** Names longer than this are cut, so a hostile title cannot stretch a row. */
const NAME_LIMIT = 80;
const DISPLAY_LOCALE = 'en-US';

/**
 * Epoch milliseconds from a Firestore Timestamp, a Date, or a number; null
 * for anything else.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return null;
}

/** Newest first; a missing time sorts after every known one. */
function newestFirst(aMs, bMs) {
  if (aMs === bMs) return 0;
  if (aMs == null) return 1;
  if (bMs == null) return -1;
  return bMs - aMs;
}

function byId(a, b) {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function cut(text) {
  return text.length > NAME_LIMIT ? `${text.slice(0, NAME_LIMIT - 1)}…` : text;
}

/** A record's whole readable name, uncut: see recordNameOf. */
function fullNameOf(collection, doc) {
  for (const key of ['title', 'name', 'label', 'question']) {
    const value = doc?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (collection === 'cmsContent' && typeof doc?.section === 'string' && typeof doc?.field === 'string') {
    return `${doc.section} › ${doc.field}`;
  }
  return String(doc?.id ?? '');
}

/**
 * A record's readable name: its title, name, label or question; for a
 * content block, then "section › field"; else the document id. Cut at 80
 * characters.
 *
 * @param {string} collection
 * @param {{ id: string } & Record<string, unknown>} doc
 * @returns {string}
 */
export function recordNameOf(collection, doc) {
  return cut(fullNameOf(collection, doc));
}

/**
 * "Sep 23, 2026, 2:02 PM EDT" on the event's clock; the reader's clock and
 * its label with no zone or one Intl does not know.
 *
 * @param {number|null} ms
 * @param {string} [timeZone]
 * @returns {string|null}
 */
export function formatPublishedAt(ms, timeZone) {
  if (!Number.isFinite(ms)) return null;
  const instant = new Date(ms);
  const options = { dateStyle: 'medium', timeStyle: 'short' };
  let text;
  let zone;
  try {
    if (typeof timeZone !== 'string' || !timeZone) throw new RangeError('no zone');
    text = new Intl.DateTimeFormat(DISPLAY_LOCALE, { ...options, timeZone }).format(instant);
    zone = timeZone;
  } catch {
    text = new Intl.DateTimeFormat(DISPLAY_LOCALE, options).format(instant);
    zone = undefined;
  }
  const label = zoneLabel(zone, instant);
  return label ? `${text} ${label}` : text;
}

/**
 * A draft's state word, from the draft alone: a draft forked from a live
 * revision is "Live with unpublished changes"; one that never went live is
 * "Draft". Every live document is written by publishDocs, which stamps
 * `basedOnRevision` on the draft, so this matches recordStateOf.
 *
 * @param {{ basedOnRevision?: unknown }} draft
 */
export function draftStateOf(draft) {
  return typeof draft?.basedOnRevision === 'number' ? state('dirty') : state('draft');
}

/**
 * The page's rows: per collection in the admin's order, every dirty draft,
 * newest save first and then by id. Nothing is filtered, so each
 * collection's row count is its share of the shell's count. `name` is cut
 * at 80 characters for the row; `fullName` is the whole name, for readers.
 *
 * @param {Record<string, Array<object>>} docsByCollection
 * @returns {Array<{ choice: typeof COLLECTION_CHOICES[number], rows: Array<object> }>}
 */
export function groupPending(docsByCollection) {
  return COLLECTION_CHOICES.map((choice) => {
    const docs = Array.isArray(docsByCollection?.[choice.id]) ? docsByCollection[choice.id] : [];
    const rows = docs.map((draft) => ({
      id: draft.id,
      name: recordNameOf(choice.id, draft),
      fullName: fullNameOf(choice.id, draft),
      state: draftStateOf(draft),
      hidden: draft.visible === false,
      section: typeof draft.section === 'string' ? draft.section : null,
      field: typeof draft.field === 'string' ? draft.field : null,
      savedAt: toMillis(draft.updatedAt),
      savedBy: typeof draft.updatedBy === 'string' ? draft.updatedBy : null,
    }));
    rows.sort((a, b) => newestFirst(a.savedAt, b.savedAt) || byId(a, b));
    return { choice, rows };
  });
}

const EDITOR_SEGMENT = Object.freeze({
  cmsPages: 'pages',
  cmsSchedule: 'sessions',
  cmsUpdates: 'updates',
  cmsOrganizations: 'organizations',
  cmsTimeline: 'timeline',
});

/**
 * The editor a row opens, or null. A content block opens its block editor
 * when a page lists its section, and the content index when none does. A
 * link appears only once the docket owns that section as staff work, so a
 * collection whose editor has not landed gets no link rather than a dead
 * one. Every segment is encoded; a stored value is never an href.
 *
 * @param {string} collection
 * @param {{ id: string, section?: string|null, field?: string|null }} row
 * @param {Array<{ id: string, current?: { sections?: Array<{ id: string }> } }>} [pages]
 * @returns {string|null}
 */
export function editorPathFor(collection, row, pages = []) {
  const encode = encodeURIComponent;
  let path = null;
  if (collection === 'cmsContent') {
    const owner = row?.section
      ? (pages ?? []).find((page) =>
          (page?.current?.sections ?? []).some((section) => section?.id === row.section),
        )
      : null;
    path = owner && row.field
      ? `/admin/content/${encode(owner.id)}/${encode(row.section)}/${encode(row.field)}`
      : '/admin/content';
  } else if (EDITOR_SEGMENT[collection] && row?.id) {
    path = `/admin/${EDITOR_SEGMENT[collection]}/${encode(row.id)}`;
  }
  if (!path) return null;
  return sectionTier(path) === 'staff' ? path : null;
}

function countIds(map) {
  if (!map || typeof map !== 'object') return 0;
  return Object.values(map).reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0);
}

function countProgress(progress, key) {
  if (!progress || typeof progress !== 'object') return 0;
  return Object.values(progress).reduce(
    (sum, entry) => sum + (Array.isArray(entry?.[key]) ? entry[key].length : 0),
    0,
  );
}

const RUN_WORDS = Object.freeze({
  done: { word: 'Done', tone: 'done' },
  running: { word: 'Running', tone: 'info' },
  failed: { word: 'Failed', tone: 'error' },
});

/**
 * One publish run as a word and a sentence: "12 of 12 published.",
 * "5 of 12 published so far.", "5 of 12 published before it stopped."
 *
 * @param {{ id: string, status?: string, request?: object, progress?: object }} row
 * @returns {{ id: string, word: string, tone: string, sentence: string|null }}
 */
export function runSummary(row) {
  const requested = countIds(row?.request);
  const published = countProgress(row?.progress, 'published');
  const skipped = countProgress(row?.progress, 'skipped');
  const known = RUN_WORDS[row?.status];
  if (!known) return { id: row?.id, word: 'Unknown', tone: 'neutral', sentence: null };
  let sentence;
  if (row.status === 'done') {
    sentence = `${published} of ${requested} published.`;
    if (skipped > 0) sentence += ` ${skipped} skipped.`;
  } else if (row.status === 'running') {
    sentence = `${published} of ${requested} published so far.`;
  } else {
    sentence = `${published} of ${requested} published before it stopped.`;
  }
  return { id: row.id, word: known.word, tone: known.tone, sentence };
}

/**
 * The recent runs and the failed runs as one list: each run once, newest
 * request first.
 *
 * @param {Array<object>|null} recent
 * @param {Array<object>|null} failed
 * @returns {Array<object>}
 */
export function mergeRuns(recent, failed) {
  const runs = new Map();
  for (const row of [...(recent ?? []), ...(failed ?? [])]) {
    if (row?.id && !runs.has(row.id)) runs.set(row.id, row);
  }
  return [...runs.values()].sort(
    (a, b) => newestFirst(toMillis(a.requestedAt), toMillis(b.requestedAt)) || byId(a, b),
  );
}

function changesWords(count) {
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

/**
 * Read a whole-site cmsPublish answer (Publish all, or a resume): what it
 * asked for is what it reports, per collection.
 *
 * @param {{ results?: Record<string, { published?: string[], skipped?: Array<{ docId: string }> }> }} response
 * @returns {{ ok: boolean, message: string }}
 */
export function summarizeAll(response) {
  const results = response?.results && typeof response.results === 'object' ? response.results : {};
  const collections = Object.keys(results);
  if (collections.length === 0) return { ok: true, message: 'Nothing was waiting to be published.' };
  const problems = [];
  let publishedCount = 0;
  for (const collection of collections) {
    const result = results[collection] ?? {};
    const published = Array.isArray(result.published) ? result.published : [];
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];
    const ids = [...published, ...skipped.map((entry) => entry?.docId).filter(Boolean)];
    const choice = COLLECTION_CHOICES.find((candidate) => candidate.id === collection);
    const verdict = summarizePublish(response, collection, ids, choice?.plural ?? collection);
    publishedCount += verdict.published.length;
    if (!verdict.ok) problems.push(verdict.message);
  }
  if (problems.length === 0) {
    const pronoun = publishedCount === 1 ? 'it' : 'them';
    return { ok: true, message: `Published ${changesWords(publishedCount)}. The public site picks ${pronoun} up live.` };
  }
  return { ok: false, message: problems.join(' ') };
}

