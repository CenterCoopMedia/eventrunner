'use strict';

/**
 * The delivery state of one email record (state machine map, root cause 5).
 * `uncertain` means the provider may have accepted the message: the send threw
 * or timed out after the request went out, so a retry can deliver a second
 * copy. Every flow stores `uncertain` (owner decision, 2026-11-08). Pitch and
 * change request notices stored `unknown` before then; readers pass stored
 * values through `deliveryStateOf`.
 *
 *   queued      the record is written and the send has not finished
 *   sent        the provider accepted it
 *   failed      the provider refused it; a retry is safe
 *   uncertain   it may have been sent; retry only after a person checks
 *   suppressed  the address is on the provider's suppression list
 */
const NOTICE_STATES = Object.freeze(['queued', 'sent', 'failed', 'uncertain', 'suppressed']);
const LEGACY_DELIVERY_STATES = Object.freeze({ unknown: 'uncertain' });

function deliveryStateOf(state) {
  return Object.hasOwn(LEGACY_DELIVERY_STATES, state) ? LEGACY_DELIVERY_STATES[state] : state;
}

module.exports = { NOTICE_STATES, deliveryStateOf };
