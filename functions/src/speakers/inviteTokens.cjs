'use strict';

/**
 * Invite-token primitives for the speaker invite pipeline (spec §4.1
 * `speaker_invites/{token}`, §4.3 pipeline state, issue #21).
 *
 * Kept separate from ./invites.cjs so the two collections that also
 * INVALIDATE a live invite — the admin CRUD in ./profile.cjs and the delete
 * paths in ./lifecycle.cjs — can do it inside their own transaction without
 * a require cycle (invites.cjs requires lifecycle.cjs for the seam-#3 link
 * primitive, so lifecycle.cjs must not require invites.cjs back).
 *
 * **Hash at rest, like OTP codes.** The raw token exists in exactly two
 * places: the invite email, and the URL the speaker pastes back. Nothing
 * server-side stores it. `speaker_invites/{sha256(token)}` is the lookup
 * document and `speakers/{id}.inviteToken` holds the SAME digest, so
 * "is this the token currently outstanding for this speaker" is one
 * comparison and rotation is one write.
 *
 * SHA-256 rather than the scrypt `auth/challenges.cjs` uses on OTP codes,
 * deliberately: scrypt is there because a six-digit code has only 10^6
 * values and falls to offline brute force beside its salt. An invite token
 * is 32 bytes from `crypto.randomBytes` — 2^256 — so a fast digest costs an
 * attacker nothing they could ever spend, while a ~100ms KDF on the
 * ACCEPTANCE path would be a free denial-of-service lever on an endpoint
 * that (unlike verifyOtpCode) has no attempt counter to hide behind.
 *
 * The digest is also the document id, which is why the collection is keyed
 * by hash and not by the token the spec table names: a document id is not a
 * secret store — ids appear in logs, in error messages, and in any listing
 * an operator runs — so the id is the digest and the secret never lands in
 * one.
 */

const crypto = require('node:crypto');

const SPEAKER_INVITES = 'speaker_invites';

/**
 * How long an invite link stays usable. Fourteen days: long enough that a
 * speaker who is travelling when the mail lands can still act on it,
 * short enough that a link forwarded into a mailing-list archive stops
 * working within one event's planning cycle. `resendSpeakerInvite` mints a
 * fresh one, so expiry is never a dead end.
 */
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Invite lifecycle, stored on `speaker_invites/{hash}.status`:
 *
 *   pending     minted and mailed; the only status acceptance accepts
 *   accepted    consumed — single use, never accepted twice
 *   cancelled   revoked by an admin (cancelSpeakerInvite)
 *   superseded  replaced by a newer token (resendSpeakerInvite), or
 *               invalidated because the speaker left `invited` some other
 *               way (an admin status edit, a soft or hard delete)
 */
const INVITE_STATUSES = Object.freeze(['pending', 'accepted', 'cancelled', 'superseded']);

/** Statuses that no longer name a usable token. */
const INVITE_TERMINAL_STATUSES = Object.freeze(['accepted', 'cancelled', 'superseded']);

/** Speaker statuses an invite may be sent from (spec §4.3: draft → invited). */
const INVITABLE_SPEAKER_STATUSES = Object.freeze(['draft']);

const TOKEN_RE = /^[0-9a-f]{64}$/;

/** A fresh single-use invite token. 32 bytes, hex. */
function mintInviteToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Digest of a raw token — the `speaker_invites` document id and the value
 * stored in `speakers.inviteToken`.
 *
 * @param {string} token
 * @returns {string} sha256 hex
 */
function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/** Shape check only; a well-formed token is still worthless without a match. */
function isWellFormedToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/** ms, in whichever shape the store handed back (Date, Timestamp, ISO). */
function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  return Date.parse(value);
}

/**
 * The URL the invite email links to. Root-segment `speaker` is reserved in
 * packages/shared/src/routing.cjs, so no admin-authored cmsPages path can
 * ever shadow it.
 *
 * @param {object} config core/config.cjs shape
 * @param {string} token
 * @returns {string}
 */
function buildInviteUrl(config, token) {
  const site = String(config?.tierA?.publicUrl || '').replace(/\/+$/, '');
  return `${site}/speaker/accept?token=${encodeURIComponent(token)}`;
}

/**
 * `r***@example.org` — enough for the accept page to say WHICH inbox the
 * invitation went to without printing the address in full.
 *
 * The token holder almost certainly received that mail already, so this is
 * not a confidentiality boundary; it is damage limitation for the one case
 * that matters, an invite URL pasted somewhere public (a shared screen, a
 * ticket, a chat log), where the full address would otherwise ride along.
 *
 * @param {string|null|undefined} email
 * @returns {string}
 */
function maskEmail(email) {
  const value = typeof email === 'string' ? email.trim() : '';
  const at = value.lastIndexOf('@');
  if (at < 1) return '';
  const local = value.slice(0, at);
  const domain = value.slice(at);
  return `${local[0]}${'*'.repeat(Math.max(2, Math.min(local.length - 1, 5)))}${domain}`;
}

/**
 * Invalidate whatever invite `speaker` currently holds, inside the CALLER'S
 * transaction, and return the patch the caller must merge onto the speaker
 * document.
 *
 * Every writer that moves a speaker off `invited` calls this: resend
 * (`superseded`), cancel (`cancelled`), acceptance (`accepted`), an admin
 * status edit, and both delete paths. Doing it in the caller's transaction
 * is what keeps "the speaker is no longer invited" and "the token no longer
 * works" one commit rather than two — the same one-commit discipline §4.3
 * seam #3 applies to the users.speakerId ↔ speakers.uid pair.
 *
 * No read is needed: the invite document id IS `speaker.inviteToken`, so
 * this is a blind merge and can be called after the caller's own reads
 * without violating Firestore's read-before-write rule.
 *
 * @param {{ tx: object, db: object, speaker: object|null|undefined,
 *           at: Date, status: string, actorEmail?: string|null }} args
 * @returns {{ inviteToken: null }} the speaker patch
 */
function invalidateInviteInTx({ tx, db, speaker, at, status, actorEmail = null }) {
  const hash = typeof speaker?.inviteToken === 'string' && speaker.inviteToken
    ? speaker.inviteToken
    : null;
  if (hash) {
    tx.set(
      db.collection(SPEAKER_INVITES).doc(hash),
      { status, closedAt: at, closedBy: actorEmail, updatedAt: at },
      { merge: true },
    );
  }
  return { inviteToken: null };
}

module.exports = {
  SPEAKER_INVITES,
  INVITE_TTL_MS,
  INVITE_STATUSES,
  INVITE_TERMINAL_STATUSES,
  INVITABLE_SPEAKER_STATUSES,
  mintInviteToken,
  hashInviteToken,
  isWellFormedToken,
  timestampMs,
  buildInviteUrl,
  maskEmail,
  invalidateInviteInTx,
  internals: { TOKEN_RE },
};
