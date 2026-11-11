'use strict';

// Issue #510: the composer and HTTP boundary share these limits and count
// normalized text in UTF-16 code units (String.length), including emoji.
const MAX_SOCIAL_TEXT_LENGTH = 2000;
const MAX_SOCIAL_REQUEST_BYTES = 8 * 1024;
const MAX_SOCIAL_THREAD_PAGE_SIZE = 50;
const SUBMISSION_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const POST_FIELDS = new Set(['text', 'parentPostId', 'submissionKey']);

function socialTextLength(text) {
  return typeof text === 'string' ? text.trim().length : 0;
}

function socialRequestBytes(body) {
  try {
    return new TextEncoder().encode(JSON.stringify(body)).byteLength;
  } catch {
    return Infinity;
  }
}

function readSocialPost(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Send a post object.' };
  }
  if (Object.keys(body).some((key) => !POST_FIELDS.has(key))) {
    return { ok: false, message: 'Only text, parentPostId and submissionKey are accepted.' };
  }
  if (typeof body.text !== 'string' || socialTextLength(body.text) === 0) {
    return { ok: false, message: 'text: Enter a post.' };
  }
  if (socialTextLength(body.text) > MAX_SOCIAL_TEXT_LENGTH) {
    return { ok: false, message: `text: Use at most ${MAX_SOCIAL_TEXT_LENGTH} UTF-16 code units.` };
  }
  if (typeof body.submissionKey !== 'string' || !SUBMISSION_KEY_RE.test(body.submissionKey)) {
    return { ok: false, message: 'submissionKey: must be 8-128 characters of [A-Za-z0-9_-].' };
  }
  const parentPostId = body.parentPostId === undefined ? null : body.parentPostId;
  // Bounded document IDs, also usable for the foundation's seeded roots.
  if (parentPostId !== null && (typeof parentPostId !== 'string'
      || parentPostId.length === 0 || parentPostId.length > 128
      || parentPostId.includes('/') || parentPostId === '.' || parentPostId === '..')) {
    return { ok: false, message: 'parentPostId: must be a post id or null.' };
  }
  return { ok: true, text: body.text.trim(), parentPostId, submissionKey: body.submissionKey };
}

module.exports = {
  MAX_SOCIAL_TEXT_LENGTH,
  MAX_SOCIAL_REQUEST_BYTES,
  MAX_SOCIAL_THREAD_PAGE_SIZE,
  socialTextLength,
  socialRequestBytes,
  readSocialPost,
};
