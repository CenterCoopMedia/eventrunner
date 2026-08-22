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

test('send does not touch any file unless E2E_MAIL_FILE is set', async () => {
  const writes = [];
  const provider = createConsoleProvider({
    env: { FUNCTIONS_EMULATOR: 'true' },
    log: fakeLog(),
    appendFileSync: (...args) => writes.push(args),
  });
  await provider.send({ to: 'a@example.com', subject: 's' });
  assert.deepEqual(writes, []);
});

test('send appends one JSON line per message when E2E_MAIL_FILE is set', async () => {
  const writes = [];
  const provider = createConsoleProvider({
    env: { FUNCTIONS_EMULATOR: 'true', E2E_MAIL_FILE: '/tmp/mail.jsonl' },
    log: fakeLog(),
    appendFileSync: (path, data) => writes.push({ path, data }),
  });
  await provider.send({ to: 'a@example.com', subject: 'Hello', tag: 'auth.otp', text: 'code 123456' });
  await provider.send({ to: 'b@example.com', subject: 'Bye' });

  assert.equal(writes.length, 2);
  assert.equal(writes[0].path, '/tmp/mail.jsonl');
  // One line, newline-terminated, and parseable on its own — the e2e reader
  // splits on newlines, so a message must never span two lines.
  assert.ok(writes[0].data.endsWith('\n'));
  assert.equal(writes[0].data.trimEnd().includes('\n'), false);
  const first = JSON.parse(writes[0].data);
  assert.equal(first.to, 'a@example.com');
  assert.equal(first.tag, 'auth.otp');
  assert.equal(first.text, 'code 123456');
  assert.equal(JSON.parse(writes[1].data).to, 'b@example.com');
});

test('an all-whitespace E2E_MAIL_FILE is treated as unset', async () => {
  const writes = [];
  const provider = createConsoleProvider({
    env: { FUNCTIONS_EMULATOR: 'true', E2E_MAIL_FILE: '   ' },
    log: fakeLog(),
    appendFileSync: (...args) => writes.push(args),
  });
  await provider.send({ to: 'a@example.com', subject: 's' });
  assert.deepEqual(writes, []);
});

test('does not implement verifyDeliveryWebhook so ingest refuses every request', () => {
  const provider = createConsoleProvider({ env: { FUNCTIONS_EMULATOR: 'true' }, log: fakeLog() });
  assert.equal(provider.verifyDeliveryWebhook, undefined);
  assert.equal(provider.parseDeliveryEvent, undefined);
});
