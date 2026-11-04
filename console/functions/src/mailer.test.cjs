'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  STATUS_WORDS, agreementCopyMessage, createPostmarkMailer, inviteMessage, operatorNoticeMessage, statusChangeMessage,
} = require('./mailer.cjs');

test('no status email uses hosting jargon', () => {
  for (const status of Object.keys(STATUS_WORDS)) {
    const { text } = statusChangeMessage({ organizationName: 'NC Local', eventName: 'Summit', status, note: 'n', link: '' });
    assert.ok(!/firebase|project|tenant|environment|webhook|secret|stripe|checkout/i.test(text), text);
  }
});

const invite = {
  to: 'sam@example.org',
  organizationName: 'Local <News> & Co',
  inviterEmail: 'ana@example.org',
  role: 'owner',
  link: 'https://console.eventrunner.org/invite/i1#token=abc',
  expiresInDays: 7,
};

test('inviteMessage names the organization, the role, the link and the expiry in plain words', () => {
  const message = inviteMessage(invite);
  assert.equal(message.subject, 'Join Local <News> & Co on Event Runner');
  assert.match(message.text, /ana@example\.org invited you to join Local <News> & Co as an Owner\./);
  assert.match(message.text, /https:\/\/console\.eventrunner\.org\/invite\/i1#token=abc/);
  assert.match(message.text, /works once and expires in 7 days/);
  assert.ok(!/firebase|project|tenant/i.test(message.text));
  assert.match(inviteMessage({ ...invite, role: 'editor' }).text, /as an Editor\./);
});

test('inviteMessage escapes the HTML body', () => {
  const { html } = inviteMessage(invite);
  assert.ok(html.includes('Local &lt;News&gt; &amp; Co'));
  assert.ok(!html.includes('<News>'));
  assert.ok(html.includes('href="https://console.eventrunner.org/invite/i1#token=abc"'));
});

test('the Postmark mailer posts one message with the server token', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ MessageID: 'm1' }) };
  };
  const mailer = createPostmarkMailer({ token: 'pm-token', from: 'Event Runner <hello@console.example>', fetch });
  await mailer.sendInvite(invite);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.postmarkapp.com/email');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Postmark-Server-Token'], 'pm-token');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.To, 'sam@example.org');
  assert.equal(body.From, 'Event Runner <hello@console.example>');
  assert.equal(body.MessageStream, 'outbound');
  assert.equal(body.Subject, 'Join Local <News> & Co on Event Runner');
  assert.ok(body.TextBody && body.HtmlBody);
});

test('the Postmark mailer throws on a refused send and never logs the token', async () => {
  const fetch = async () => ({ ok: false, status: 422, json: async () => ({ ErrorCode: 300, Message: 'Invalid' }) });
  const mailer = createPostmarkMailer({ token: 'pm-token', from: 'a@b.example', fetch });
  await assert.rejects(mailer.sendInvite(invite), (err) => {
    assert.match(err.message, /422/);
    assert.ok(!err.message.includes('pm-token'));
    return true;
  });
});

const change = {
  to: 'ana@example.org',
  organizationName: 'NC Local',
  eventName: 'Summit <2027>',
  status: 'changes_requested',
  link: 'https://console.eventrunner.org/organizations/o1/applications/a1',
  note: 'Add the venue address.',
};

test('statusChangeMessage says the status in plain words, with the note and the link', () => {
  const message = statusChangeMessage(change);
  assert.equal(message.subject, 'Your request needs changes: Summit <2027>');
  assert.match(message.text, /We need some changes to your request\./);
  assert.match(message.text, /Note from the hosting team:\nAdd the venue address\./);
  assert.match(message.text, /Open your request:\nhttps:\/\/console\.eventrunner\.org\/organizations\/o1\/applications\/a1/);
  assert.ok(message.html.includes('Summit &lt;2027&gt;'));
  assert.ok(!/firebase|project|tenant/i.test(message.text));
});

test('statusChangeMessage has words for every status after draft and refuses an unknown one', () => {
  assert.deepEqual(Object.keys(STATUS_WORDS).sort(), [
    'approved', 'awaiting_payment', 'building', 'changes_requested', 'declined', 'draft', 'launched', 'paid', 'ready', 'submitted', 'withdrawn',
  ]);
  for (const status of Object.keys(STATUS_WORDS)) {
    assert.ok(statusChangeMessage({ ...change, status, note: null }).text.length > 0, status);
  }
  assert.match(statusChangeMessage({ ...change, status: 'submitted', note: null }).text, /We are reviewing your request\./);
  assert.ok(!statusChangeMessage({ ...change, link: '' }).text.includes('Open your request'));
  assert.throws(() => statusChangeMessage({ ...change, status: 'lost' }), TypeError);
});

test('operatorNoticeMessage names the organization and the event', () => {
  const message = operatorNoticeMessage({ organizationName: 'NC Local', eventName: 'Summit', link: 'https://x.example/a' });
  assert.equal(message.subject, 'New request: Summit from NC Local');
  assert.match(message.text, /NC Local sent a request for a site for Summit\./);
});

test('operatorNoticeMessage says what happened to a payment', () => {
  const notice = { organizationName: 'NC Local', eventName: 'Summit', link: 'https://x.example/a' };
  assert.match(operatorNoticeMessage({ ...notice, kind: 'paid' }).subject, /^Paid: Summit/);
  assert.match(operatorNoticeMessage({ ...notice, kind: 'build-failed' }).text, /build did not start/);
  assert.match(operatorNoticeMessage({ ...notice, kind: 'payment-problem', problem: 'amount-mismatch' }).text, /amount-mismatch/);
});

test('the agreement copy holds the full text, the record details and escaped HTML', () => {
  const message = agreementCopyMessage({
    organizationName: 'NC Local',
    eventName: 'Summit',
    title: 'Test agreement',
    version: 3,
    body: 'First <b>test</b> paragraph.\n\nSecond test paragraph.',
    sha256: 'abc123',
    typedName: 'Ana Owner',
    acceptedAt: '2026-11-04T15:00:00.000Z',
    link: 'https://x.example/a',
  });
  for (const part of ['Ana Owner', 'Version 3', 'abc123', 'Test agreement', 'First <b>test</b> paragraph.', 'Second test paragraph.', '2026-11-04T15:00:00.000Z']) {
    assert.ok(message.text.includes(part), part);
  }
  assert.ok(message.html.includes('First &lt;b&gt;test&lt;/b&gt; paragraph.'));
  assert.ok(!message.html.includes('<b>'));
});

test('the Postmark mailer sends status and operator email with their own tags', async () => {
  const bodies = [];
  const fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const mailer = createPostmarkMailer({ token: 't', from: 'a@b.example', fetch });
  await mailer.sendStatusChange(change);
  await mailer.sendOperatorNotice({ to: 'ops@ccm.example', organizationName: 'NC Local', eventName: 'Summit', link: '' });
  assert.deepEqual(bodies.map((b) => [b.To, b.Tag]), [['ana@example.org', 'console-status'], ['ops@ccm.example', 'console-operator']]);
});

test('the Postmark mailer needs a token and a sender', () => {
  assert.throws(() => createPostmarkMailer({ token: '', from: 'a@b.example', fetch() {} }), TypeError);
  assert.throws(() => createPostmarkMailer({ token: 't', from: '', fetch() {} }), TypeError);
});
