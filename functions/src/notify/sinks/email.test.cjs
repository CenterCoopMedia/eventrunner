'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmailSink, internals } = require('./email.cjs');

// --- Fakes -----------------------------------------------------------------

/** sendEmail fake returning a scripted EmailSendResult, capturing calls. */
function fakeSendEmail(result) {
  const calls = [];
  const impl = async (message) => {
    calls.push(message);
    if (result instanceof Error) throw result;
    return result;
  };
  impl.calls = calls;
  return impl;
}

const PAYLOAD = {
  kind: 'error',
  title: '[EX27] sync failed',
  summary: 'ticketing sync aborted',
  fields: { provider: 'tickets-r-us', attempt: '3' },
  url: 'https://admin.example/errors/e1',
  errorId: 'e1',
  deployment: 'ex27',
  projectId: 'proj-1',
  timestamp: '2026-08-19T12:00:00.000Z',
};

// --- deliver ---------------------------------------------------------------

test('deliver sends the rendered operator mail through the email core', async () => {
  const sendEmail = fakeSendEmail({ providerMessageId: 'pm-1', status: 'sent', retries: 0 });
  const sink = createEmailSink({ sendEmail });

  const result = await sink.deliver(PAYLOAD, { operatorEmail: 'ops@example.com' });

  assert.deepEqual(result, { delivered: true, sink: 'email' });
  assert.equal(sendEmail.calls.length, 1);
  const message = sendEmail.calls[0];
  assert.equal(message.to, 'ops@example.com');
  assert.equal(message.subject, '[ex27] ERROR: [EX27] sync failed');
  assert.equal(message.source, 'operator-notify');
  assert.equal(message.tag, 'operator.notify');
  assert.match(message.text, /ticketing sync aborted/);
  assert.match(message.text, /provider: tickets-r-us/);
  assert.match(message.text, /attempt: 3/);
  assert.match(message.text, /url: https:\/\/admin\.example\/errors\/e1/);
  assert.match(message.text, /errorId: e1/);
  assert.match(message.html, /ERROR: \[EX27\] sync failed/);
});

test('deliver maps a failed EmailSendResult to delivered:false with the error', async () => {
  const sendEmail = fakeSendEmail({
    providerMessageId: null, status: 'failed', providerStatus: 500, error: 'relay down', retries: 2,
  });
  const sink = createEmailSink({ sendEmail });
  const result = await sink.deliver(PAYLOAD, { operatorEmail: 'ops@example.com' });
  assert.deepEqual(result, { delivered: false, sink: 'email', error: 'relay down' });
});

test('deliver reports missing operatorEmail without calling sendEmail', async () => {
  const sendEmail = fakeSendEmail({ status: 'sent' });
  const sink = createEmailSink({ sendEmail });
  const result = await sink.deliver(PAYLOAD, {});
  assert.deepEqual(result, {
    delivered: false, sink: 'email', error: 'no operatorEmail configured',
  });
  assert.equal(sendEmail.calls.length, 0);
});

test('deliver maps a thrown sendEmail to delivered:false without throwing', async () => {
  const sendEmail = fakeSendEmail(new Error('boom'));
  const sink = createEmailSink({ sendEmail });
  const result = await sink.deliver(PAYLOAD, { operatorEmail: 'ops@example.com' });
  assert.deepEqual(result, { delivered: false, sink: 'email', error: 'boom' });
});

// --- renderOperatorMail ----------------------------------------------------

test('renderOperatorMail escapes HTML and omits absent optional lines', () => {
  const { subject, text, html } = internals.renderOperatorMail({
    kind: 'warning',
    title: 'a <b> & "c"',
    summary: 's',
    deployment: 'ex27',
  });
  assert.equal(subject, '[ex27] WARNING: a <b> & "c"');
  assert.equal(text, 's');
  assert.match(html, /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.doesNotMatch(text, /url:/);
  assert.doesNotMatch(text, /errorId:/);
});
