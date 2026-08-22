'use strict';

/**
 * The `cmsSchedule.speakerIds[]` foreign key (spec §4.3, issue #20).
 *
 * Firestore enforces no referential integrity, so "no drift" is a claim
 * about the write seams, not about the database. This module is seam #1:
 * every session save reads each id in `speakerIds` and REJECTS the write,
 * naming the id, when `speakers/{id}` does not exist. Rejecting rather
 * than silently dropping is the point — a typo'd or stale id in an admin
 * payload is a bug to surface, not data to discard.
 *
 * Seam #2 (`deleteSpeaker`'s atomic unlink) and seam #3 (the
 * `users.speakerId` ↔ `speakers.uid` pair) live in ./lifecycle.cjs.
 */

const SPEAKERS = 'speakers';
const SPEAKERS_PUBLIC = 'speakers_public';

/** The session field holding the foreign key. */
const SPEAKER_IDS_FIELD = 'speakerIds';

/** The live collection sessions are stored in, and its draft sibling. */
const SESSIONS = 'cmsSchedule';

const MAX_SPEAKER_IDS_PER_SESSION = 50;

/**
 * Shape-check a `speakerIds` value without touching Firestore. Pure, so
 * the cheap rejections (not an array, a non-string entry, a duplicate)
 * cost no reads.
 *
 * @param {unknown} value
 * @returns {{ ok: true, speakerIds: string[] } | { ok: false, errors: string[] }}
 */
function validateSpeakerIdsShape(value) {
  if (value === undefined || value === null) return { ok: true, speakerIds: [] };
  if (!Array.isArray(value)) {
    return { ok: false, errors: [`${SPEAKER_IDS_FIELD}: must be an array of speaker ids`] };
  }
  if (value.length > MAX_SPEAKER_IDS_PER_SESSION) {
    return {
      ok: false,
      errors: [`${SPEAKER_IDS_FIELD}: must have at most ${MAX_SPEAKER_IDS_PER_SESSION} entries`],
    };
  }
  const errors = [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0 || entry.includes('/')) {
      errors.push(`${SPEAKER_IDS_FIELD}: "${String(entry)}" is not a speaker document id`);
      continue;
    }
    if (seen.has(entry)) {
      errors.push(`${SPEAKER_IDS_FIELD}: "${entry}" is listed twice`);
      continue;
    }
    seen.add(entry);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, speakerIds: [...seen] };
}

/**
 * The ids in `speakerIds` with no `speakers/{id}` document, in the order
 * they were given. One `getAll` — a session names a handful of speakers,
 * so this is a single round trip, never a collection scan (the whole point
 * of replacing the name-based join).
 *
 * Pass `tx` to read inside the caller's transaction. That is the whole
 * point at the session-save seam: a read outside the transaction that
 * writes the draft is only a pre-check, and deleteSpeaker can land between
 * the two — its own transaction queries the sessions and drafts that exist
 * NOW, so a draft written a moment later still names the deleted speaker
 * and nothing is left to heal it. Reading the speaker documents inside the
 * write transaction puts them in its read set, so a concurrent delete
 * aborts and retries the save, which then rejects.
 *
 * @param {{ db: object, speakerIds: string[], tx?: object }} args
 * @returns {Promise<string[]>}
 */
async function findMissingSpeakerIds({ db, speakerIds, tx = null }) {
  if (!Array.isArray(speakerIds) || speakerIds.length === 0) return [];
  const refs = speakerIds.map((id) => db.collection(SPEAKERS).doc(id));
  const snaps = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
  return speakerIds.filter((_id, i) => !snaps[i].exists);
}

/**
 * Seam #1 in one call: shape, then existence.
 *
 * The returned `speakerIds` is the NORMALIZED array, and callers persist
 * that rather than the raw payload value: `speakerIds: null` validates
 * (an absent reference set is not an error) but must be stored as `[]`, or
 * the stored shape stops being `string[]` and every reader has to defend
 * against it.
 *
 * @param {{ db: object, value: unknown, tx?: object }} args
 * @returns {Promise<{ ok: true, speakerIds: string[] } | { ok: false, errors: string[] }>}
 */
async function validateSpeakerReferences({ db, value, tx = null }) {
  const shape = validateSpeakerIdsShape(value);
  if (!shape.ok) return shape;
  const missing = await findMissingSpeakerIds({ db, speakerIds: shape.speakerIds, tx });
  if (missing.length > 0) {
    return {
      ok: false,
      errors: missing.map((id) => `${SPEAKER_IDS_FIELD}: no speaker exists with id "${id}"`),
    };
  }
  return shape;
}

module.exports = {
  validateSpeakerIdsShape,
  findMissingSpeakerIds,
  validateSpeakerReferences,
  internals: {
    SPEAKERS,
    SPEAKERS_PUBLIC,
    SESSIONS,
    SPEAKER_IDS_FIELD,
    MAX_SPEAKER_IDS_PER_SESSION,
  },
};
