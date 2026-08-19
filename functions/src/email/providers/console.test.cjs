'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createConsoleProvider } = require('./console.cjs');

function fakeLog() {
  const lines = [];
  return { lines, log: (...args) => lines.push(args.join(' ')) };
}

test('factory refuses to load in prod when not explicitly selected', () => {
  assert.throws(() => createConsoleProvider({ env: {} }), /refuses to load/);
  assert.throws(
    () => createConsoleProvider({ env: { FUNCTIONS_EMULATOR: 'false' } }),
    /refuses to load/,
  );
  assert.throws(
    () => createConsoleProvider({ env: { EVENT_EMAIL_PROVIDER: 'postmark' } }),
    /refuses to load/,
  );
});

test('factory loads under the emulator', () => {
  const provider = createConsoleProvider({ env: { FUNCTIONS_EMULATOR: 'true' }, log: fakeLog() });
  assert.equal(provider.name, 'console');
});

test('factory loads in prod when explicitly selected', () => {
  const provider = createConsoleProvider({
    env: { EVENT_EMAIL_PROVIDER: 'console' },
    log: fakeLog(),
  });
  assert.equal(provider.name, 'console');
});

test('send logs the rendered message and returns sent with a console- id', async () => {
  const log = fakeLog();
  const provider = createConsoleProvider({ env: { FUNCTIONS_EMULATOR: 'true' }, log });
  const result = await provider.send({
    to: 'a@example.com',
    subject: 'Hello',
    text: 'body',
    html: '<p>body</p>',
  });

  assert.equal(result.status, 'sent');
  assert.equal(result.providerStatus, 200);
  assert.match(
    result.providerMessageId,
    /^console-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  assert.equal(log.lines.length, 1);
  assert.match(log.lines[0], /a@example\.com/);
  assert.match(log.lines[0], /Hello/);
});

test('send returns a fresh id per call', async () => {
  const provider = createConsoleProvider({ env: { FUNCTIONS_EMULATOR: 'true' }, log: fakeLog() });
  const first = await provider.send({ to: 'a@example.com', subject: 's' });
  const second = await provider.send({ to: 'a@example.com', subject: 's' });
  assert.notEqual(first.providerMessageId, second.providerMessageId);
});

test('does not implement verifyDeliveryWebhook so ingest refuses every request', () => {
  const provider = createConsoleProvider({ env: { FUNCTIONS_EMULATOR: 'true' }, log: fakeLog() });
  assert.equal(provider.verifyDeliveryWebhook, undefined);
  assert.equal(provider.parseDeliveryEvent, undefined);
});
