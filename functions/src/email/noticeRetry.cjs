'use strict';

/**
 * The retry rule for a staff-sent notice (pitch emails and change request
 * emails). One copy, so the two flows cannot drift on when a second send is
 * safe. A sent email is never sent again. A queued one younger than
 * QUEUED_STALE_MS may still be sending. A stale queued one, or one whose
 * outcome is `uncertain`, may have gone, so a retry needs a person to confirm
 * they checked the Email log. A failed one is safe to retry.
 */
const { deliveryStateOf } = require('shared/delivery');

const QUEUED_STALE_MS = 10 * 60 * 1000;

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

/**
 * @returns {{ refusal: { status: number, code: string, message: string } } | { mayHaveBeenSent: boolean }}
 */
function noticeRetryState(previous, nowMs) {
  const state = deliveryStateOf(previous?.state);
  if (state === 'sent') {
    return { refusal: { status: 409, code: 'already-sent', message: 'This email was already sent. It is not sent again.' } };
  }
  if (state === 'queued') {
    const queuedAt = toMillis(previous.queuedAt);
    if (queuedAt === null || nowMs - queuedAt < QUEUED_STALE_MS) {
      return { refusal: { status: 409, code: 'in-progress', message: 'This email is being sent. Check its state again in a few minutes.' } };
    }
    return { mayHaveBeenSent: true };
  }
  return { mayHaveBeenSent: state === 'uncertain' };
}

module.exports = { QUEUED_STALE_MS, noticeRetryState, toMillis };
