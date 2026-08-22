'use strict';

/**
 * Canonical speaker vocabulary and the speakers → speakers_public
 * projection (spec §4.3).
 *
 * `speakers/{speakerId}` is the single source of truth. There is no
 * `cmsSpeakers`, no `sessionInfo` map, no `_deletedSessions` archive, and
 * no name-based join: `cmsSchedule.speakerIds[]` is a foreign key of
 * document ids, and "which sessions does this speaker have" is the query
 * `cmsSchedule.where('speakerIds','array-contains', speakerId)`.
 *
 * One definition of "what is public about a speaker", shared by the four
 * consumers that must not drift:
 *
 *   • functions/src/speakers/projection.cjs — the onSpeakerWritten trigger
 *     writes exactly buildPublicSpeaker()'s output into speakers_public.
 *   • functions/src/speakers/profile.cjs — the admin CRUD validators.
 *   • scripts/lib/demo-event.cjs — the demo fixture, whose emitted
 *     snapshot must be the same shape the trigger would have produced.
 *   • apps/web — the public speakers page renders the projection.
 *
 * NEVER public: `email`, `uid`, `inviteToken`, `status`, `approvedAt`, and
 * the write stamps. `speakers_public` is anonymously readable, so a field
 * that is not on PUBLIC_SPEAKER_FIELDS never leaves the server-only
 * document — the same rule PUBLIC_PROFILE_FIELDS applies to attendees.
 */

const { generateSpeakerSlug } = require('./slug.cjs');

/**
 * Pipeline state (§4.3). `draft` is an admin-created record that has not
 * been invited; `invited`/`accepted` belong to the invite pipeline;
 * `approved` is the one state that publishes; `removed` is the soft-delete
 * tombstone deleteSpeaker falls back to when a full unlink cannot fit in
 * one transaction.
 */
const SPEAKER_STATUSES = Object.freeze([
  'draft',
  'invited',
  'accepted',
  'approved',
  'removed',
]);

/**
 * Statuses an admin may set through the CRUD endpoints. `invited` and
 * `accepted` are deliberately excluded: they are meaningful only alongside
 * an `inviteToken`, which only the invite/acceptance transaction may
 * write, so hand-setting them would produce a speaker who looks invited
 * and holds no token.
 */
const ADMIN_SETTABLE_STATUSES = Object.freeze(['draft', 'approved', 'removed']);

/** The one status that publishes a projection. */
const PUBLISHED_SPEAKER_STATUSES = Object.freeze(['approved']);

/** Fields an admin may write through createSpeaker / updateSpeaker. */
const EDITABLE_SPEAKER_FIELDS = Object.freeze([
  'firstName',
  'lastName',
  'slug',
  'email',
  'bio',
  'headshotPath',
  'organization',
  'jobTitle',
  'socialHandles',
  'status',
]);

/**
 * Server-owned fields, rejected BY NAME when a payload carries them
 * (§4.3 rule 3): `uid` is one half of the users.speakerId ↔ speakers.uid
 * pair, which only the invite/acceptance transaction and deleteSpeaker may
 * write, and both halves move in the same commit. `inviteToken` and
 * `approvedAt` belong to the same pipeline.
 */
const SERVER_OWNED_SPEAKER_FIELDS = Object.freeze([
  'uid',
  'inviteToken',
  'approvedAt',
  // The rest of the invite pipeline's bookkeeping (issue #21): when the
  // invitation was accepted, which address accepted it, and the per-speaker
  // invite-mail send budget. All three are written only by
  // functions/src/speakers/invites.cjs, so an admin payload naming any of
  // them is rejected by name rather than silently merged — the same
  // treatment `inviteToken` gets, for the same reason.
  'acceptedAt',
  'acceptedEmail',
  'inviteSends',
  'createdAt',
  'updatedAt',
  'updatedBy',
]);

/**
 * Fields copied into `speakers_public/{speakerId}`. Deliberately excludes
 * `email`, `uid`, `inviteToken`, `status`, and `approvedAt`.
 */
const PUBLIC_SPEAKER_FIELDS = Object.freeze([
  'firstName',
  'lastName',
  'displayName',
  'slug',
  'bio',
  'headshotPath',
  'organization',
  'jobTitle',
  'socialHandles',
]);

const MAX_NAME_LENGTH = 120;
const MAX_SHORT_TEXT_LENGTH = 200;
const MAX_BIO_LENGTH = 4000;
const MAX_SOCIAL_HANDLES = 12;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function asString(v) {
  return typeof v === 'string' ? v : '';
}

/**
 * The one place a speaker's rendered name is composed. Never a stored
 * field on the canonical doc — a stored copy of first + last is exactly
 * the kind of derived duplicate §4.3 exists to remove — but it IS stored
 * on the projection, so the public page renders one field instead of
 * re-deriving the join everywhere.
 *
 * @param {{ firstName?: string, lastName?: string } | null | undefined} speaker
 * @returns {string}
 */
function speakerDisplayName(speaker) {
  const source = isPlainObject(speaker) ? speaker : {};
  return `${asString(source.firstName).trim()} ${asString(source.lastName).trim()}`.trim();
}

/**
 * True when a speaker document should have a `speakers_public` projection.
 * Everything else — draft, invited, accepted, and the `removed`
 * soft-delete tombstone — has no public document at all, which is what
 * makes the soft delete "hide the speaker everywhere" (§4.3).
 *
 * @param {object | null | undefined} speaker
 * @returns {boolean}
 */
function isPubliclyVisibleSpeaker(speaker) {
  const status = asString(isPlainObject(speaker) ? speaker.status : '');
  return PUBLISHED_SPEAKER_STATUSES.includes(status);
}

/**
 * Project a `speakers/{speakerId}` document down to its public-safe
 * fields. Total — never throws, whatever the stored doc looks like, for
 * the same reason buildPublicProfile is: the projection is what the public
 * page renders, and a map that reached the canonical doc another way must
 * not be handed to React as a child.
 *
 * @param {object | null | undefined} speaker
 * @returns {object} the speakers_public payload, minus the caller's stamps
 */
function buildPublicSpeaker(speaker) {
  const source = isPlainObject(speaker) ? speaker : {};
  const out = {
    firstName: asString(source.firstName).trim(),
    lastName: asString(source.lastName).trim(),
    displayName: speakerDisplayName(source),
    slug: asString(source.slug).trim(),
    bio: asString(source.bio),
    headshotPath: typeof source.headshotPath === 'string' && source.headshotPath
      ? source.headshotPath
      : null,
    organization: asString(source.organization),
    jobTitle: asString(source.jobTitle),
    socialHandles: isPlainObject(source.socialHandles)
      ? Object.fromEntries(
        Object.entries(source.socialHandles).filter(([, v]) => typeof v === 'string'),
      )
      : {},
  };
  if (!out.slug) out.slug = generateSpeakerSlug(out.firstName, out.lastName);
  return out;
}

/**
 * Validate an admin CRUD payload for `speakers/{id}`.
 *
 * Every message is `field: reason`, the shape apps/web's `fieldErrorsOf`
 * splits on, so a form can mark the offending input aria-invalid without
 * inventing copy.
 *
 * With `partial: true` (the update path) only the keys present are
 * checked; without it (create) firstName and lastName are required.
 *
 * @param {unknown} payload
 * @param {{ partial?: boolean }} [options]
 * @returns {{ ok: true, fields: object } | { ok: false, errors: string[] }}
 */
function validateSpeaker(payload, { partial = false } = {}) {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['speaker: must be an object'] };
  }

  const errors = [];
  for (const key of SERVER_OWNED_SPEAKER_FIELDS) {
    if (key in payload) {
      errors.push(
        key === 'uid'
          ? 'uid: read-only — the users.speakerId link is written only by the invite/acceptance transaction and deleteSpeaker'
          : `${key}: read-only — server-owned`,
      );
    }
  }
  for (const key of Object.keys(payload)) {
    if (!EDITABLE_SPEAKER_FIELDS.includes(key) && !SERVER_OWNED_SPEAKER_FIELDS.includes(key)) {
      errors.push(`${key}: unknown speaker field`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const fields = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);

  for (const key of ['firstName', 'lastName']) {
    if (!has(key)) {
      if (!partial) errors.push(`${key}: required`);
      continue;
    }
    const value = payload[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`${key}: must be a non-empty string`);
    } else if (value.trim().length > MAX_NAME_LENGTH) {
      errors.push(`${key}: must be at most ${MAX_NAME_LENGTH} characters`);
    } else {
      fields[key] = value.trim();
    }
  }

  if (has('slug')) {
    const value = payload.slug;
    if (value === null || value === '') {
      // An explicitly cleared slug is re-derived from the name below.
      fields.slug = '';
    } else if (typeof value !== 'string' || !SLUG_RE.test(value)) {
      errors.push('slug: must be lowercase letters, digits, and single hyphens');
    } else {
      fields.slug = value;
    }
  }

  if (has('email')) {
    const value = payload.email;
    if (value === null || value === '') {
      fields.email = null;
    } else if (typeof value !== 'string' || !EMAIL_RE.test(value.trim())) {
      errors.push('email: must be an email address');
    } else {
      fields.email = value.trim().toLowerCase();
    }
  }

  for (const [key, limit] of [
    ['bio', MAX_BIO_LENGTH],
    ['organization', MAX_SHORT_TEXT_LENGTH],
    ['jobTitle', MAX_SHORT_TEXT_LENGTH],
  ]) {
    if (!has(key)) continue;
    const value = payload[key];
    if (typeof value !== 'string') {
      errors.push(`${key}: must be a string`);
    } else if (value.length > limit) {
      errors.push(`${key}: must be at most ${limit} characters`);
    } else {
      fields[key] = value;
    }
  }

  if (has('headshotPath')) {
    const value = payload.headshotPath;
    if (value === null || value === '') {
      fields.headshotPath = null;
    } else if (typeof value !== 'string') {
      errors.push('headshotPath: must be a Storage path or null');
    } else {
      fields.headshotPath = value;
    }
  }

  if (has('socialHandles')) {
    const value = payload.socialHandles;
    if (!isPlainObject(value)) {
      errors.push('socialHandles: must be an object of label → handle');
    } else if (Object.keys(value).length > MAX_SOCIAL_HANDLES) {
      errors.push(`socialHandles: must have at most ${MAX_SOCIAL_HANDLES} entries`);
    } else if (Object.values(value).some((v) => typeof v !== 'string')) {
      errors.push('socialHandles: every value must be a string');
    } else {
      fields.socialHandles = { ...value };
    }
  }

  if (has('status')) {
    const value = payload.status;
    if (!ADMIN_SETTABLE_STATUSES.includes(value)) {
      errors.push(`status: must be one of ${ADMIN_SETTABLE_STATUSES.join(', ')}`);
    } else {
      fields.status = value;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // A slug is never left blank: an empty or omitted one is derived from
  // the name that is about to be stored. Callers that only sent a partial
  // update without either name leave it alone (the stored slug stands).
  if (fields.slug === '' || (!partial && fields.slug === undefined)) {
    const derived = generateSpeakerSlug(fields.firstName, fields.lastName);
    if (!derived) {
      return { ok: false, errors: ['slug: could not be derived from the name; provide one'] };
    }
    fields.slug = derived;
  }
  if (fields.slug === '') delete fields.slug;

  return { ok: true, fields };
}

module.exports = {
  SPEAKER_STATUSES,
  ADMIN_SETTABLE_STATUSES,
  PUBLISHED_SPEAKER_STATUSES,
  EDITABLE_SPEAKER_FIELDS,
  SERVER_OWNED_SPEAKER_FIELDS,
  PUBLIC_SPEAKER_FIELDS,
  speakerDisplayName,
  isPubliclyVisibleSpeaker,
  buildPublicSpeaker,
  validateSpeaker,
  internals: {
    MAX_NAME_LENGTH,
    MAX_SHORT_TEXT_LENGTH,
    MAX_BIO_LENGTH,
    MAX_SOCIAL_HANDLES,
    SLUG_RE,
    EMAIL_RE,
  },
};
