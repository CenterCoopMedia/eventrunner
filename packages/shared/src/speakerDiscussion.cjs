'use strict';

const MAX_DISCUSSION_POINTS_LENGTH = 10000;

/** One current private submission per speaker, independent of profile approval. */
function validateDiscussionPoints(payload) {
  const errors = [];
  const allowed = ['speakerId', 'text', 'expectedRevision', 'requestId'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some((key) => !allowed.includes(key))) {
    errors.push('submission: Use only speakerId, text, expectedRevision and requestId.');
  }
  const text = typeof payload?.text === 'string' ? payload.text.replace(/\r\n?/g, '\n').trim() : '';
  if (!text || text.length > MAX_DISCUSSION_POINTS_LENGTH) {
    errors.push(`text: Enter 1 to ${MAX_DISCUSSION_POINTS_LENGTH} characters.`);
  }
  // Tabs and line breaks are valid plain text; other control codes are not.
  // eslint-disable-next-line no-control-regex -- control codes are the invalid input
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    errors.push('text: Remove control characters.');
  }
  if (!Number.isSafeInteger(payload?.expectedRevision) || payload.expectedRevision < 0) {
    errors.push('expectedRevision: Load the saved submission before saving.');
  }
  if (typeof payload?.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(payload.requestId)) {
    errors.push('requestId: Use a new request identifier for each submission.');
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, fields: { text, expectedRevision: payload.expectedRevision, requestId: payload.requestId } };
}

module.exports = { MAX_DISCUSSION_POINTS_LENGTH, validateDiscussionPoints };
