'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { internal } = require('./errors.cjs');

test('the default internal response gives a failure fact and a safe next action', () => {
  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  internal(response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: {
      code: 'internal',
      message: 'The request could not be completed. Keep this page open and contact support for help.',
    },
  });
});
