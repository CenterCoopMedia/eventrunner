'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPostmarkMailer, inviteMessage } = require('./mailer.cjs');

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

test('the Postmark mailer needs a token and a sender', () => {
  assert.throws(() => createPostmarkMailer({ token: '', from: 'a@b.example', fetch() {} }), TypeError);
  assert.throws(() => createPostmarkMailer({ token: 't', from: '', fetch() {} }), TypeError);
});
