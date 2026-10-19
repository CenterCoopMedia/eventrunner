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
 *
 * A value that resolves to nothing is a row error that names it. The parent
 * session is not importable: a parent must be a published top-level
 * session on the same day and track, and staff set it in the editor.
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
  internals: { cell, cellOrNull, externalIdError, importKeyId, conflictNote, DELETED_NOTE, RECORD_IMPORTS },
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
    let speakerId = keySnap.exists ? keySnap.data()?.docId : null;
    if (speakerId && !(await tx.get(db.collection('speakers').doc(speakerId))).exists) speakerId = null;
    if (!speakerId) {
      const bySlug = await tx.get(db.collection('speakers').where('slug', '==', token).limit(1));
      speakerId = bySlug.docs[0]?.id ?? null;
    }
    if (speakerId) {
      if (!ids.includes(speakerId)) ids.push(speakerId);
    } else {
      reasons.push(`speakers: "${token}" matches no speaker external ID or slug. Import the speakers first.`);
    }
  }
  return { ids, reasons };
}

/** True when a session id is used live, as a draft, or earlier in this file. */
async function idTaken({ db, tx, id, claimed }) {
  if (claimed.has(`session:${id}`)) return true;
  const [live, draft] = await Promise.all([
    tx.get(db.collection(SESSIONS).doc(id)),
    tx.get(db.collection(SESSIONS_DRAFTS).doc(id)),
  ]);
  return live.exists || draft.exists;
}

async function allocateId({ db, tx, input, claimed }) {
  if (input.slug) {
    if (await idTaken({ db, tx, id: input.slug, claimed })) {
      return { ok: false, reason: `slug: another session already uses "${input.slug}". Map a different session ID.` };
    }
    return { ok: true, id: input.slug };
  }
  const base = sessionIdFromTitle(input.values.title) || 'session';
  for (let n = 1; n <= MAX_ID_SUFFIX; n += 1) {
    const suffix = n === 1 ? '' : `-${n}`;
    const id = `${base.slice(0, MAX_SESSION_ID_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (RESERVED_SESSION_IDS.has(id) || !isValidDocId(id)) continue;
    if (!(await idTaken({ db, tx, id, claimed }))) return { ok: true, id };
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
    const fields = { speakerIds: [], ...incoming };
    const checked = await checkSession({ db, tx, docId, fields });
    if (!checked.ok) return { verdict: 'error', docId, label: incoming.title ?? null, reasons: checked.reasons };
    return {
      verdict: 'create',
      docId,
      label: checked.fields.title,
      changedFields: Object.keys(incoming),
      values: incoming,
      claims: [`session:${docId}`],
      async write(writeTx) {
        await writeDraft({
          db, tx: writeTx, collection: SESSIONS, docId, fields: checked.fields, visible: false, actor, now, createOnly: true,
        });
      },
    };
  }

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
  const changedFields = Object.keys(patch);
  const label = patch.title ?? current.title ?? null;
  if (changedFields.length === 0) return { verdict: 'unchanged', docId, label, notes, values: incoming };

  const checked = await checkSession({ db, tx, docId, fields: { ...current, ...patch } });
  if (!checked.ok) return { verdict: 'error', docId, label, reasons: checked.reasons };
  return {
    verdict: 'update',
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
  internals: { STORED_FIELD, normalizeClock, sessionIdFromTitle, resolveDay, resolveTrack, resolvePlace },
};
