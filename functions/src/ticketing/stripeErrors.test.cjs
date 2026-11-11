'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripeErrorDetails } = require('./stripeErrors.cjs');

test('Stripe diagnostics retain identifiers and never include payloads or credentials', () => {
  assert.deepEqual(stripeErrorDetails({ type: 'StripePermissionError', code: 'account_invalid',
    statusCode: 403, requestId: 'req_123abc', message: 'private payload', raw: { token: 'private' } }),
  { type: 'StripePermissionError', code: 'account_invalid', statusCode: 403, requestId: 'req_123abc' });
  assert.deepEqual(stripeErrorDetails({ type: 'Bearer private', code: 'private@example.test', requestId: 'sk_test_private' }), {});
  assert.deepEqual(stripeErrorDetails(null), {});
});
