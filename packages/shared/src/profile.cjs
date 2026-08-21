'use strict';

/**
 * Attendee profile vocabulary and the users → users_public projection
 * (spec §3.4, §4.1, §4.5).
 *
 * One definition of "which fields does the account owner control" and
 * "which fields are public-safe", shared by three consumers that must not
 * drift:
 *
 *   • firestore.rules — the self-update allowlist is hand-mirrored there
 *     (rules cannot import JavaScript), so SELF_EDITABLE_PROFILE_FIELDS is
 *     the list the rules block is kept in sync with.
 *   • functions/src/users/projection.cjs — the syncUserPublic trigger
 *     projects exactly PUBLIC_PROFILE_FIELDS and rewrites `badges` to the
 *     intersection with config/badges (§4.5).
 *   • apps/web — the profile setup form writes only self-editable fields.
 *
 * SERVER-OWNED, never in the self-editable list: `speakerId`,
 * `registrationStatus`, `approvalSource`, `role`, `email`, `createdAt`,
 * and `profileComplete` (derived by the maintainProfileComplete trigger
 * from the fields the owner does control).
 * `speakerId` and `registrationStatus` are written by the invite/approval
 * transactions alone (§3.4, §4.3); the rules deny them to the client, and
 * this module is the reason there is exactly one list to check that
 * against.
 */

const { validateBadgeSelection } = require('./badges.cjs');

/** Profile/directory visibility vocabulary (§4.1, renamed from scheduleVisibility). */
const PROFILE_VISIBILITIES = ['public', 'attendees_only', 'private'];

/**
 * Visibility a freshly created account gets. `attendees_only` — a new
 * account is not published to the open web by a default nobody chose.
 */
const DEFAULT_PROFILE_VISIBILITY = 'attendees_only';

/**
 * Fields the account owner may write to their own `users/{uid}` doc.
 * Mirrored by the `users` update rule in firestore.rules — changing one
 * without the other is the bug this constant exists to make obvious.
 */
const SELF_EDITABLE_PROFILE_FIELDS = Object.freeze([
  'displayName',
  'pronouns',
  'bio',
  'organization',
  'jobTitle',
  'photoPath',
  'socialHandles',
  'badges',
  'profileVisibility',
  'updatedAt',
]);

/**
 * Fields the projection copies into `users_public/{uid}`. Deliberately
 * excludes `email`, `registrationStatus`, `approvalSource`, and `role`:
 * `users_public` is readable by other attendees (and anonymously at
 * `public` visibility), so anything not on this list never leaves the
 * server-only document.
 */
const PUBLIC_PROFILE_FIELDS = Object.freeze([
  'displayName',
  'pronouns',
  'bio',
  'organization',
  'jobTitle',
  'photoPath',
  'socialHandles',
  'badges',
  'profileVisibility',
  'speakerId',
]);

/** @param {*} v @returns {boolean} */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * True when `v` is one of the three visibility values.
 *
 * @param {*} v
 * @returns {boolean}
 */
function isValidProfileVisibility(v) {
  return typeof v === 'string' && PROFILE_VISIBILITIES.includes(v);
}

/**
 * A profile is "complete" once it carries the two fields every directory
 * card and profile page renders — a display name and a chosen visibility.
 * Everything else is optional by design: an attendee who wants to be
 * listed with a name and nothing else is a supported outcome, not an
 * incomplete one.
 *
 * @param {object | null | undefined} user - a users/{uid} document
 * @returns {boolean}
 */
function isProfileComplete(user) {
  if (!user || typeof user !== 'object') return false;
  return isNonEmptyString(user.displayName) && isValidProfileVisibility(user.profileVisibility);
}

/**
 * Project a `users/{uid}` document down to its public-safe fields
 * (§4.1, §4.5).
 *
 * Total — never throws, whatever the stored doc looks like:
 *   • only PUBLIC_PROFILE_FIELDS are copied; unknown keys are dropped, so
 *     a field added to `users` is private until it is added here;
 *   • `badges` is rewritten to the intersection with the configured badge
 *     set (§4.5 — rules cannot check list membership, so this trigger is
 *     where an unconfigured badge id stops being public);
 *   • `profileVisibility` falls back to the default when missing or
 *     invalid, because the read rules branch on it: an unreadable value
 *     must fail closed to the non-public default, never to `public`;
 *   • `socialHandles` is copied only when it is a plain object.
 *
 * @param {object | null | undefined} user - the users/{uid} document data
 * @param {object | null | undefined} badgesConfig - the config/badges document
 * @returns {object} the users_public/{uid} payload (no timestamps — the
 *   caller stamps `updatedAt` with a server value)
 */
function buildPublicProfile(user, badgesConfig) {
  const source = user && typeof user === 'object' ? user : {};
  const out = {};
  for (const field of PUBLIC_PROFILE_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    out[field] = value;
  }

  out.badges = validateBadgeSelection(
    Array.isArray(source.badges) ? source.badges : [],
    badgesConfig,
  ).valid;

  if (!isValidProfileVisibility(out.profileVisibility)) {
    out.profileVisibility = DEFAULT_PROFILE_VISIBILITY;
  }
  if (typeof out.displayName !== 'string') out.displayName = '';
  if (out.socialHandles == null || typeof out.socialHandles !== 'object'
    || Array.isArray(out.socialHandles)) {
    out.socialHandles = {};
  }
  out.speakerId = typeof source.speakerId === 'string' && source.speakerId ? source.speakerId : null;

  return out;
}

module.exports = {
  PROFILE_VISIBILITIES,
  DEFAULT_PROFILE_VISIBILITY,
  SELF_EDITABLE_PROFILE_FIELDS,
  PUBLIC_PROFILE_FIELDS,
  isValidProfileVisibility,
  isProfileComplete,
  buildPublicProfile,
};
