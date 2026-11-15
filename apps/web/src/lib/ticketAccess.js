// Ticket access refusals in the browser (#1007). After an operator publishes
// a ticket resource policy, the server answers 403 `access-updating` (the
// grant is being recomputed) or 403 `ticket-resource` (the ticket does not
// include the resource); functions/src/ticketing/resourceAccess.cjs. The
// browser never reads the private grant itself, so these two codes are all
// it knows. A Firestore read refusal cannot tell them apart.

const STATES = Object.freeze({ 'access-updating': 'updating', 'ticket-resource': 'not-included' });

export const ACCESS_UPDATING_TEXT = 'Access updating. Try again in a few minutes.';

const NOT_INCLUDED_TEXT = Object.freeze({
  session: 'Your ticket does not include this session.',
  feed: 'Your ticket does not include the attendee feed.',
});

/** 'updating', 'not-included', or null for any other error code. */
export function ticketAccessState(code) {
  return STATES[code] ?? null;
}

/**
 * The words for a ticket access state.
 *
 * @param {'updating'|'not-included'} state
 * @param {'session'|'feed'} subject
 */
export function ticketAccessText(state, subject) {
  return state === 'updating' ? ACCESS_UPDATING_TEXT : NOT_INCLUDED_TEXT[subject];
}

/** A feed or thread read refused while the account itself qualifies. */
export const FEED_ACCESS_REFUSED_TEXT =
  'Your ticket does not include the attendee feed, or your access is updating. This page checks again in the background.';
