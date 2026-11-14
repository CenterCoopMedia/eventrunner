'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_DISCUSSION_POINTS_LENGTH,
  validateDiscussionPoints,
} = require('./speakerDiscussion.cjs');

const REQUEST_ID = 'request_12345678';

test('normalizes a valid discussion-points submission at the shared boundary', () => {
  assert.equal(MAX_DISCUSSION_POINTS_LENGTH, 10_000);
  assert.deepEqual(validateDiscussionPoints({
    text: '  Opening question\r\n\tFollow-up question\rFinal question  ',
    expectedRevision: 0,
    requestId: REQUEST_ID,
  }), {
    ok: true,
    fields: {
      text: 'Opening question\n\tFollow-up question\nFinal question',
      expectedRevision: 0,
      requestId: REQUEST_ID,
    },
  });
});

test('accepts the documented text and request-id limits', () => {
  for (const requestId of ['a'.repeat(16), 'A_-9'.repeat(20)]) {
    const result = validateDiscussionPoints({
      text: 'x'.repeat(MAX_DISCUSSION_POINTS_LENGTH),
      expectedRevision: 42,
      requestId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.fields.text.length, MAX_DISCUSSION_POINTS_LENGTH);
  }
});

test('rejects blank, oversized and control-character text', () => {
  for (const text of [
    '',
    ' \n\t ',
    'x'.repeat(MAX_DISCUSSION_POINTS_LENGTH + 1),
    'Question\u0000answer',
    'Question\u000banswer',
  ]) {
    const result = validateDiscussionPoints({ text, expectedRevision: 0, requestId: REQUEST_ID });
    assert.equal(result.ok, false, JSON.stringify({ textLength: text.length, result }));
    assert.ok(result.errors.some((error) => error.startsWith('text:')), JSON.stringify(result));
  }
});

test('rejects malformed revisions, request ids and payload fields', () => {
  const cases = [
    null,
    { text: 'Question', expectedRevision: -1, requestId: REQUEST_ID },
    { text: 'Question', expectedRevision: 1.5, requestId: REQUEST_ID },
    { text: 'Question', expectedRevision: 0, requestId: 'a'.repeat(15) },
    { text: 'Question', expectedRevision: 0, requestId: 'a'.repeat(81) },
    { text: 'Question', expectedRevision: 0, requestId: 'invalid request id' },
    { text: 'Question', expectedRevision: 0, requestId: REQUEST_ID, revision: 99 },
  ];
  for (const payload of cases) {
    const result = validateDiscussionPoints(payload);
    assert.equal(result.ok, false, JSON.stringify({ payload, result }));
    assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
  }
});
