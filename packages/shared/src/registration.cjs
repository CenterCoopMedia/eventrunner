'use strict';

/**
 * Registration state machine and access predicates (spec §3.4).
 *
 * One provider-neutral vocabulary shared by the frontend gate and the
 * server gate so they cannot diverge (the reference implementation carried
 * three different status lists across three files, plus a fourth value one
 * admin tab wrote).
 *
 * NOTE: `hasAttendeeAccess` is NOT the authorization boundary — it is
 * JavaScript running in the browser and in Cloud Functions and cannot gate
 * a direct Firestore read. The Firestore rules (spec §3.4) are the
 * boundary; this predicate exists so UI gating and server handlers agree
 * with them.
 */

/** The four registration statuses, in lifecycle order. */
const REGISTRATION_STATUSES = ['pending', 'ticketed', 'approved', 'revoked'];

// Transition table (spec §3.4), keyed "from->to" with the triggers that
// permit each edge. `null` from-state is account creation.
const TRANSITIONS = [
  { from: null, to: 'pending', triggers: ['account_created'] },
  { from: 'pending', to: 'ticketed', triggers: ['ticket_claimed'] },
  { from: 'ticketed', to: 'approved', triggers: ['admin_approval', 'auto_approve'] },
  { from: 'pending', to: 'approved', triggers: ['admin_approval'] },
  { from: 'approved', to: 'revoked', triggers: ['admin_revocation', 'entitlement_lost'] },
  { from: 'ticketed', to: 'revoked', triggers: ['admin_revocation', 'entitlement_lost'] },
  { from: 'revoked', to: 'approved', triggers: ['admin_reapproval'] },
];

/**
 * True when (from → to) under the named trigger is an edge of the spec
 * §3.4 table. Account creation passes `from` as null/undefined. Total —
 * unknown states, targets, or triggers are simply false.
 *
 * @param {string | null | undefined} from - current status, or null for a new account
 * @param {string} to - proposed status
 * @param {string} trigger - one of: 'account_created', 'ticket_claimed',
 *   'admin_approval', 'auto_approve', 'admin_revocation',
 *   'entitlement_lost', 'admin_reapproval'
 * @returns {boolean}
 */
function isValidTransition(from, to, trigger) {
  const normalizedFrom = from == null ? null : from;
  return TRANSITIONS.some(
    (t) => t.from === normalizedFrom && t.to === to && t.triggers.includes(trigger)
  );
}

/**
 * Recompute whether a user is entitled to attendee access from the two
 * grant sources (spec §3.4). An explicit admin approval survives every
 * ticket refund — a scholarship/volunteer/press grant is a decision the
 * ticketing provider knows nothing about. Only `false` here may move a
 * ticketed/approved user to 'revoked'.
 *
 * @param {{ hasValidTicket?: boolean, approvalSource?: string | null }} input
 * @returns {boolean}
 */
function computeEntitlement(input) {
  if (!input || typeof input !== 'object') return false;
  return input.hasValidTicket === true || input.approvalSource === 'admin';
}

/**
 * UI/handler access predicate: true for approved attendees, speakers
 * (profile.speakerId set), and admins. Not an authorization boundary —
 * see the module doc; the Firestore rules enforce the same policy
 * server-side.
 *
 * @param {{ registrationStatus?: string, speakerId?: string | null, role?: string } | null | undefined} profile
 * @returns {boolean}
 */
function hasAttendeeAccess(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (profile.registrationStatus === 'approved') return true;
  if (profile.speakerId != null) return true;
  return profile.role === 'admin' || profile.role === 'super_admin';
}

module.exports = {
  REGISTRATION_STATUSES,
  isValidTransition,
  computeEntitlement,
  hasAttendeeAccess,
};
