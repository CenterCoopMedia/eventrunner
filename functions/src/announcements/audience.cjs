'use strict';

/**
 * Who an announcement email goes to (issue #202), resolved on the server
 * from private account records (`users/{uid}`), never from the public
 * directory projection and never from a list the browser sends.
 *
 * Each audience is a rule over fields the server owns (spec §3.4):
 *
 *   registered  registrationStatus 'approved' or 'ticketed': people with
 *               attendee access, and people who claimed a ticket and wait
 *               for approval. Both registered for this event.
 *   approved    registrationStatus 'approved' only.
 *   speakers    accounts linked to a speaker record (speakerId set).
 *
 * A revoked account is never in an audience. An account with no usable
 * address is left out and counted. Addresses are compared lowercased and
 * each address gets one copy, however many accounts share it. Every
 * address with a suppression record (an unsubscribe) is left out and
 * counted, so the count the composer confirms is the count that is sent.
 * Account creation alone is not in any audience: a pending account has
 * not registered.
 */

const { normalizeEmail, suppressionIdFor, readSuppressedIds, internals: suppressionInternals } = require('./suppression.cjs');

const { EMAIL_RE } = suppressionInternals;

/** The most recipients one send may freeze on its record. */
const MAX_AUDIENCE = 5000;

const AUDIENCES = Object.freeze({
  registered: Object.freeze({
    label: 'Registered attendees',
    description: 'Approved attendees and people who claimed a ticket.',
    statuses: Object.freeze(['approved', 'ticketed']),
  }),
  approved: Object.freeze({
    label: 'Approved attendees',
    description: 'Accounts with approved attendee access.',
    statuses: Object.freeze(['approved']),
  }),
  speakers: Object.freeze({
    label: 'Speakers',
    description: 'Accounts linked to a speaker profile.',
    speakers: true,
  }),
});

/** The audiences as the composer lists them. */
function listAudiences() {
  return Object.entries(AUDIENCES).map(([id, { label, description }]) => ({ id, label, description }));
}

function isAudience(id) {
  return typeof id === 'string' && Object.hasOwn(AUDIENCES, id);
}

class AudienceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AudienceError';
    this.code = code;
  }
}

/**
 * Resolve an audience to its recipients.
 *
 * @param {{ db: FirebaseFirestore.Firestore, audience: string }} args
 * @returns {Promise<{ recipients: Array<{ uid: string, email: string }>,
 *   suppressed: number, unusable: number }>} recipients sorted by address
 * @throws {AudienceError} unknown audience, or more than MAX_AUDIENCE
 */
async function resolveAudience({ db, audience }) {
  if (!isAudience(audience)) throw new AudienceError('unknown-audience', 'audience: must be one of the listed audiences');
  const rule = AUDIENCES[audience];
  let query = db.collection('users');
  query = rule.speakers
    ? query.where('speakerId', '!=', null)
    : query.where('registrationStatus', 'in', [...rule.statuses]);
  const snap = await query.select('email', 'registrationStatus', 'speakerId').get();

  const byEmail = new Map();
  let unusable = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (data.registrationStatus === 'revoked') continue;
    if (rule.speakers && (typeof data.speakerId !== 'string' || data.speakerId === '')) continue;
    const email = normalizeEmail(data.email);
    if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
      unusable += 1;
      continue;
    }
    if (!byEmail.has(email)) byEmail.set(email, { uid: doc.id, email });
  }

  const candidates = [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
  const suppressedIds = await readSuppressedIds(db, candidates.map((r) => suppressionIdFor(r.email)));
  const recipients = candidates.filter((r) => !suppressedIds.has(suppressionIdFor(r.email)));
  if (recipients.length > MAX_AUDIENCE) {
    throw new AudienceError(
      'audience-too-large',
      `audience: holds ${recipients.length} addresses; one send may reach at most ${MAX_AUDIENCE}`,
    );
  }
  return { recipients, suppressed: candidates.length - recipients.length, unusable };
}

module.exports = {
  AUDIENCES,
  MAX_AUDIENCE,
  AudienceError,
  listAudiences,
  isAudience,
  resolveAudience,
};
