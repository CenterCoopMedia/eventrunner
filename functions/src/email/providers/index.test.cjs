'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getEmailProvider } = require('./index.cjs');

const fetchImpl = async () => {
  throw new Error('registry tests never hit the network');
};

test('dispatches to postmark', () => {
  const provider = getEmailProvider({
    env: { EVENT_EMAIL_PROVIDER: 'postmark', EMAIL_PROVIDER_API_KEY: 'token' },
    fetchImpl,
  });
  assert.equal(provider.name, 'postmark');
  assert.equal(typeof provider.send, 'function');
  assert.equal(typeof provider.verifySenderDomain, 'function');
});

test('dispatches to webhook', () => {
  const provider = getEmailProvider({
    env: {
      EVENT_EMAIL_PROVIDER: 'webhook',
      EMAIL_WEBHOOK_URL: 'https://relay.example/send',
      EMAIL_WEBHOOK_SECRET: 'secret',
    },
    fetchImpl,
  });
  assert.equal(provider.name, 'webhook');
  assert.equal(typeof provider.verifyDeliveryWebhook, 'function');
});

test('dispatches to console when explicitly selected outside the emulator', () => {
  const provider = getEmailProvider({ env: { EVENT_EMAIL_PROVIDER: 'console' } });
  assert.equal(provider.name, 'console');
});

test('defaults to console ONLY under the emulator', () => {
  const provider = getEmailProvider({ env: { FUNCTIONS_EMULATOR: 'true' } });
  assert.equal(provider.name, 'console');
});

test('throws a clear error naming the variable when unset outside the emulator', () => {
  assert.throws(() => getEmailProvider({ env: {} }), /EVENT_EMAIL_PROVIDER/);
  assert.throws(
    () => getEmailProvider({ env: { FUNCTIONS_EMULATOR: 'false' } }),
    /EVENT_EMAIL_PROVIDER/,
  );
  assert.throws(
    () => getEmailProvider({ env: { EVENT_EMAIL_PROVIDER: '' } }),
    /EVENT_EMAIL_PROVIDER/,
  );
});

test('throws on an unknown provider name', () => {
  assert.throws(
    () => getEmailProvider({ env: { EVENT_EMAIL_PROVIDER: 'pigeon' } }),
    /Unknown EVENT_EMAIL_PROVIDER "pigeon"/,
  );
});

test('adapter misconfiguration surfaces through the registry', () => {
  // Selected adapters validate their own env at factory time.
  assert.throws(
    () => getEmailProvider({ env: { EVENT_EMAIL_PROVIDER: 'postmark' } }),
    /EMAIL_PROVIDER_API_KEY/,
  );
  assert.throws(
    () => getEmailProvider({ env: { EVENT_EMAIL_PROVIDER: 'webhook' } }),
    /EMAIL_WEBHOOK_URL/,
  );
});
