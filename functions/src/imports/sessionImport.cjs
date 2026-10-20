'use strict';

/**
 * Session rows for the record import (./recordImport.cjs).
 *
 * A session is a `cmsSchedule` record in the two-revision model, so the
 * import writes `cmsSchedule_drafts` only, through store.writeDraft, the
 * same primitive the session editor's save goes through. A new session is a
 * hidden draft (`visible: false`). An update writes the merged draft and
 * keeps the record's visibility.
 *
 * Validation is the editor's own: schedule/sessions.cjs
 * `validateSessionStructure` (title, description, day, times, track, place,
 * recording link, parent rules) and speakers/references.cjs
 * `validateSpeakerReferences`, both inside the row's transaction, judged on
 * the merged record.
 *
 * FRIENDLY VALUES. A file names a day, a track and a room the way people
 * do, so each one resolves against config/event before it is stored:
 *
 *   day      the day's id, its date (YYYY-MM-DD) or its label
 *   track    the track letter or the track name
 *   place    the place id or the place name
 *   times    24-hour "09:30" or 12-hour "9:30 AM", stored as "09:30"
 *   speakers speaker external IDs (from a speaker import) or speaker slugs,
 *            separated by ";" or "|"
 *   materialsNotNeeded  "yes" sets the mark; "no" or a blank cell clears
 *            it. y/n, true/false and 1/0 work too. The mark is stored as
 *            true or null, as the editor stores it, so a cleared mark and
 *            one never set compare equal on a re-import
 *
 * A value that resolves to nothing is a row error that names it. The parent
 * session is not importable: a parent must be a published top-level
 * session on the same day and track, and staff set it in the editor. A
 * speaker that was removed is a row error too: the session would link a
 * speaker the site never shows.
 *
 * A SESSION THAT ALREADY EXISTS. A row with no key is matched to an
 * existing session no import has linked (recordImport.cjs) when the row's
 * mapped session ID names it, or when the ID its title suggests names a
 * session with the same title on the same day. Titles such as "Lunch"
 * repeat across days, so a title alone does not match: the row then makes
 * a new session with a "-2" suffix and a note that names the other one.
 */

const { generateSlug } = require('shared/slug');
const { contentFieldsOf, writeDraft, isValidDocId } = require('../cms/store.cjs');
const { withoutSeedFlag } = require('./seedFlag.cjs');
const { validateSpeakerReferences } = require('../speakers/references.cjs');
const {
  validateSessionStructure,
  normalizeSessionRecordingUrl,
  internals: { SESSIONS, SESSIONS_DRAFTS, RESERVED_SESSION_IDS },
} = require('../schedule/sessions.cjs');
const {
  reconcileFields,
  internals: {
    cell, cellOrNull, externalIdError, importKeyId, conflictNote, linkedByImport, matchNote, DELETED_NOTE, RECORD_IMPORTS,
  },
} = require('./recordImport.cjs');

const TYPE = 'sessions';

const FIELDS = Object.freeze([
  { id: 'externalId', required: true },
  { id: 'title', required: true },
  { id: 'description' },
  { id: 'day' },
  { id: 'startTime' },
  { id: 'endTime' },
  { id: 'track' },
  { id: 'place' },
  { id: 'location' },
  { id: 'recordingUrl' },
  { id: 'materialsNotNeeded' },
  { id: 'speakers' },
  { id: 'slug' },
]);

/** Mapping field → the stored session field it fills. */
const STORED_FIELD = Object.freeze({
  title: 'title',
  description: 'description',
  day: 'dayId',
  startTime: 'startTime',
  endTime: 'endTime',
  track: 'track',
  place: 'placeId',
  location: 'location',
  recordingUrl: 'recordingUrl',
  materialsNotNeeded: 'materialsNotNeeded',
  speakers: 'speakerIds',
});

const SESSION_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SESSION_ID_LENGTH = 100;
/** How many "-2", "-3"… suffixes a derived session id tries. */
const MAX_ID_SUFFIX = 50;
const SPEAKER_SPLIT_RE = /[;|]/;

function mappingError(mapping) {
  if (!mapping.externalId) return 'mapping.externalId: map a column to the external ID';
  if (!mapping.title) return 'mapping.title: map a column to the session title';
  return null;
}

/**
 * The days, tracks and places the event defines, read once per request.
 * The track and place checks in validateSessionStructure read the config
 * again inside each write, so a settings change mid-import is still caught.
 */
async function loadContext({ db }) {
  const snap = await db.collection('config').doc('event').get();
  const event = snap.exists ? snap.data() : {};
  const list = (value) => (Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : []);
  return {
    days: list(event?.days),
    tracks: list(event?.tracks),
    places: list(event?.venue?.places),
  };
}

const lower = (value) => String(value ?? '').trim().toLowerCase();

function resolveDay(raw, days) {
  const wanted = lower(raw);
  const day = days.find((d) => lower(d.id) === wanted)
    ?? days.find((d) => lower(d.date) === wanted)
    ?? days.find((d) => lower(d.label) === wanted);
  return day ? { ok: true, value: day.id } : {
    ok: false,
    reason: `day: "${raw}" is not one of the event's days. Use the day's ID, date or label from event settings.`,
  };
}

function resolveTrack(raw, tracks) {
  const wanted = lower(raw);
  const track = tracks.find((t) => lower(t.letter) === wanted) ?? tracks.find((t) => lower(t.name) === wanted);
  return track ? { ok: true, value: track.letter } : {
    ok: false,
    reason: `track: "${raw}" is not one of the event's tracks. Use the track letter or name from event settings.`,
  };
}

function resolvePlace(raw, places) {
  const wanted = lower(raw);
  const place = places.find((p) => lower(p.id) === wanted) ?? places.find((p) => lower(p.name) === wanted);
  return place ? { ok: true, value: place.id } : {
    ok: false,
    reason: `place: "${raw}" is not one of the venue's places. Use the place ID or name from event settings.`,
  };
}

const YES_WORDS = new Set(['yes', 'y', 'true', '1']);
const NO_WORDS = new Set(['no', 'n', 'false', '0']);

/**
 * A yes-or-no cell as the stored mark: true for yes, null for no or a
 * blank cell. Anything else is a row error.
 *
 * @param {string|null} raw
 * @returns {{ ok: true, value: true|null } | { ok: false, reason: string }}
 */
function resolveYesNo(field, raw) {
  if (raw === null) return { ok: true, value: null };
  const wanted = lower(raw);
  if (YES_WORDS.has(wanted)) return { ok: true, value: true };
  if (NO_WORDS.has(wanted)) return { ok: true, value: null };
  return { ok: false, reason: `${field}: "${raw}" is not yes or no. Write yes, no, or leave the cell empty.` };
}

/**
 * A clock time as the editor stores it ("HH:MM"), or the text unchanged
 * when it is not a time, so the shared validator names the problem.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeClock(raw) {
  const text = raw.trim();
  let match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const hour = Number(match[1]);
    if (hour <= 23 && Number(match[2]) <= 59) return `${String(hour).padStart(2, '0')}:${match[2]}`;
    return text;
  }
  match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?$/);
  if (match) {
    let hour = Number(match[1]);
    const minute = match[2] ?? '00';
    if (hour < 1 || hour > 12 || Number(minute) > 59) return text;
    const pm = match[3].toLowerCase() === 'p';
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }
  return text;
}

/** The session id a title suggests (the editor's sessionIdFromTitle rule). */
function sessionIdFromTitle(title) {
  return generateSlug(String(title ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, ''))
    .slice(0, MAX_SESSION_ID_LENGTH)
    .replace(/-+$/, '');
}

/**
 * One row as the session fields it maps, with days, tracks, places and
 * times resolved. Speaker tokens are resolved in planRow, which can read.
 */
function mapRow({ row, mapping, context }) {
  const externalId = cell(row[mapping.externalId]);
  const idError = externalIdError(externalId);
  if (idError) return { ok: false, externalId: externalId || null, reasons: [idError] };

  const reasons = [];
  const values = {};
  for (const field of ['title', 'description', 'location', 'recordingUrl']) {
    if (mapping[field]) values[STORED_FIELD[field]] = cellOrNull(row[mapping[field]]);
  }
  for (const field of ['startTime', 'endTime']) {
    if (!mapping[field]) continue;
    const raw = cellOrNull(row[mapping[field]]);
    values[field] = raw === null ? null : normalizeClock(raw);
  }
  for (const [field, resolve, list] of [
    ['day', resolveDay, context.days],
    ['track', resolveTrack, context.tracks],
    ['place', resolvePlace, context.places],
  ]) {
    if (!mapping[field]) continue;
    const raw = cellOrNull(row[mapping[field]]);
    if (raw === null) {
      values[STORED_FIELD[field]] = null;
      continue;
    }
    const resolved = resolve(raw, list);
    if (resolved.ok) values[STORED_FIELD[field]] = resolved.value;
    else reasons.push(resolved.reason);
  }
  if (mapping.materialsNotNeeded) {
    const resolved = resolveYesNo('materialsNotNeeded', cellOrNull(row[mapping.materialsNotNeeded]));
    if (resolved.ok) values.materialsNotNeeded = resolved.value;
    else reasons.push(resolved.reason);
  }
  let speakerTokens = null;
  if (mapping.speakers) {
    speakerTokens = [...new Set(cell(row[mapping.speakers]).split(SPEAKER_SPLIT_RE).map((t) => t.trim()).filter(Boolean))];
  }
  const slug = mapping.slug ? cell(row[mapping.slug]) : '';
  if (slug && (slug.length > MAX_SESSION_ID_LENGTH || !SESSION_ID_RE.test(slug) || RESERVED_SESSION_IDS.has(slug))) {
    reasons.push(`slug: "${slug}" is not a usable session ID. Use lowercase letters, digits and single hyphens.`);
  }
  if (reasons.length > 0) return { ok: false, externalId, reasons };
  return { ok: true, externalId, input: { values, speakerTokens, slug } };
}

/**
 * Speaker tokens → speaker document ids, read in the row's transaction.
 * A token is a speaker's external ID first, then a speaker slug.
 */
async function resolveSpeakers({ db, tx, tokens }) {
  const ids = [];
  const reasons = [];
  for (const token of tokens) {
    const keySnap = await tx.get(db.collection(RECORD_IMPORTS).doc(importKeyId('speakers', token)));
    const keyed = keySnap.exists ? keySnap.data()?.docId : null;
    let speaker = keyed ? await tx.get(db.collection('speakers').doc(keyed)) : null;
    if (!speaker?.exists) {
      const bySlug = await tx.get(db.collection('speakers').where('slug', '==', token).limit(1));
      speaker = bySlug.docs[0] ?? null;
    }
    if (!speaker?.exists) {
      reasons.push(`speakers: "${token}" matches no speaker external ID or slug. Import the speakers first.`);
    } else if (speaker.data()?.status === 'removed') {
      reasons.push(`speakers: "${token}" is a removed speaker. Restore the speaker on the Speakers page, or take them off this row.`);
    } else if (!ids.includes(speaker.id)) {
      ids.push(speaker.id);
    }
  }
  return { ids, reasons };
}

/** The stored session at an id (draft first, then live), or null. */
async function storedSession({ db, tx, id }) {
  const [draft, live] = await Promise.all([
    tx.get(db.collection(SESSIONS_DRAFTS).doc(id)),
    tx.get(db.collection(SESSIONS).doc(id)),
  ]);
  if (draft.exists) return draft.data();
  return live.exists ? live.data() : null;
}

/**
 * The id a new row's session gets, or the existing session it matches
 * (module doc). `note` names an existing session the row did not match.
 *
 * @returns {Promise<{ ok: true, id: string, matched: boolean, note?: string } |
 *                   { ok: false, reason: string }>}
 */
async function allocateId({ db, tx, input, claimed }) {
  const linked = (id) => linkedByImport({ db, tx, type: TYPE, docId: id });
  if (input.slug) {
    if (claimed.has(`session:${input.slug}`)) {
      return { ok: false, reason: `slug: an earlier row of this file uses "${input.slug}". Map a different session ID.` };
    }
    if (!(await storedSession({ db, tx, id: input.slug }))) return { ok: true, id: input.slug, matched: false };
    if (await linked(input.slug)) {
      return {
        ok: false,
        reason: `slug: the session "${input.slug}" belongs to another external ID from an earlier import. Check the external ID, or map a different session ID.`,
      };
    }
    return { ok: true, id: input.slug, matched: true };
  }
  const base = sessionIdFromTitle(input.values.title) || 'session';
  let note;
  for (let n = 1; n <= MAX_ID_SUFFIX; n += 1) {
    const suffix = n === 1 ? '' : `-${n}`;
    const id = `${base.slice(0, MAX_SESSION_ID_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (RESERVED_SESSION_IDS.has(id) || !isValidDocId(id)) continue;
    if (claimed.has(`session:${id}`)) continue;
    const existing = await storedSession({ db, tx, id });
    if (!existing) return { ok: true, id, matched: false, note };
    if (n === 1) {
      const sameTitle = lower(existing.title) === lower(input.values.title);
      const dayMapped = Object.prototype.hasOwnProperty.call(input.values, 'dayId');
      const sameDay = !dayMapped || input.values.dayId === existing.dayId;
      if (sameTitle && sameDay && !(await linked(id))) return { ok: true, id, matched: true };
      note = `A session with the ID "${id}" already exists. This row makes a new session. If it is the same session, map a session ID column with "${id}".`;
    }
  }
  return { ok: false, reason: 'slug: no free session ID could be made from this title. Map a session ID column.' };
}

/** The merged record through the editor's own seams, in the row's transaction. */
async function checkSession({ db, tx, docId, fields }) {
  let checked = fields;
  if (Object.prototype.hasOwnProperty.call(checked, 'speakerIds')) {
    const references = await validateSpeakerReferences({ db, tx, value: checked.speakerIds });
    if (!references.ok) return { ok: false, reasons: references.errors };
    checked = { ...checked, speakerIds: references.speakerIds };
  }
  const structure = await validateSessionStructure({ db, tx, docId, fields: checked });
  if (!structure.ok) return { ok: false, reasons: structure.message.split('; ') };
  return { ok: true, fields: normalizeSessionRecordingUrl(checked) };
}

async function planRow({ db, tx, input, key, claimed, actor, now }) {
  const incoming = { ...input.values };
  if (input.speakerTokens) {
    const speakers = await resolveSpeakers({ db, tx, tokens: input.speakerTokens });
    if (speakers.reasons.length > 0) {
      return { verdict: 'error', label: incoming.title ?? null, reasons: speakers.reasons };
    }
    incoming.speakerIds = speakers.ids;
  }
  if (incoming.recordingUrl) incoming.recordingUrl = normalizeSessionRecordingUrl(incoming).recordingUrl;

  if (!key) {
    const allocated = await allocateId({ db, tx, input, claimed });
    if (!allocated.ok) return { verdict: 'error', label: incoming.title ?? null, reasons: [allocated.reason] };
    const docId = allocated.id;
    if (allocated.matched) {
      return planUpdate({ db, tx, incoming, key: { docId, values: null }, actor, now, matched: true });
    }
    const fields = { speakerIds: [], ...incoming };
    const checked = await checkSession({ db, tx, docId, fields });
    if (!checked.ok) return { verdict: 'error', docId, label: incoming.title ?? null, reasons: checked.reasons };
    return {
      verdict: 'create',
      docId,
      label: checked.fields.title,
      changedFields: Object.keys(incoming),
      notes: allocated.note ? [allocated.note] : [],
      values: incoming,
      claims: [`session:${docId}`],
      async write(writeTx) {
        await writeDraft({
          db, tx: writeTx, collection: SESSIONS, docId, fields: checked.fields, visible: false, actor, now, createOnly: true,
        });
      },
    };
  }
  return planUpdate({ db, tx, incoming, key, actor, now });
}

async function planUpdate({ db, tx, incoming, key, actor, now, matched = false }) {
  const docId = key.docId;
  const [draftSnap, liveSnap] = await Promise.all([
    tx.get(db.collection(SESSIONS_DRAFTS).doc(docId)),
    tx.get(db.collection(SESSIONS).doc(docId)),
  ]);
  const base = draftSnap.exists ? draftSnap.data() : liveSnap.exists ? liveSnap.data() : null;
  if (!base) return { verdict: 'unchanged', docId, label: incoming.title ?? null, notes: [DELETED_NOTE] };
  const current = withoutSeedFlag(contentFieldsOf(base));

  const { patch, conflicts } = reconcileFields({ incoming, last: key.values, current });
  const notes = conflicts.map(conflictNote);
  if (matched) notes.unshift(matchNote('session', docId, 'session ID'));
  const changedFields = Object.keys(patch);
  const label = patch.title ?? current.title ?? null;
  const claims = matched ? [`session:${docId}`] : [];
  if (changedFields.length === 0) {
    // A matched row still links the record, so it is an update.
    return { verdict: matched ? 'update' : 'unchanged', matched, docId, label, notes, values: incoming, claims };
  }

  const checked = await checkSession({ db, tx, docId, fields: { ...current, ...patch } });
  if (!checked.ok) return { verdict: 'error', docId, label, reasons: checked.reasons };
  return {
    verdict: 'update',
    matched,
    claims,
    docId,
    label,
    changedFields,
    notes,
    values: incoming,
    async write(writeTx) {
      // No `visible`: writeDraft keeps the record's own visibility.
      await writeDraft({ db, tx: writeTx, collection: SESSIONS, docId, fields: checked.fields, actor, now });
    },
  };
}

module.exports = {
  type: TYPE,
  docPath: SESSIONS_DRAFTS,
  fields: FIELDS,
  mappingError,
  loadContext,
  mapRow,
  planRow,
  internals: { STORED_FIELD, normalizeClock, sessionIdFromTitle, resolveDay, resolveTrack, resolvePlace, resolveYesNo },
};
