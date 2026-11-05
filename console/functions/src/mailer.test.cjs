'use strict';

const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { agreementPdf } = require('./agreementPdf.cjs');
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
  status: 'declined',
  link: 'https://console.eventrunner.org/organizations/o1/applications/a1',
  note: 'This is not an event.',
};

test('statusChangeMessage says the status in plain words, with the note and the link', () => {
  const message = statusChangeMessage(change);
  assert.equal(message.subject, 'We cannot build this site: Summit <2027>');
  assert.match(message.text, /We cannot build this site\./);
  assert.match(message.text, /Note from the hosting team:\nThis is not an event\./);
  assert.match(message.text, /Open your request:\nhttps:\/\/console\.eventrunner\.org\/organizations\/o1\/applications\/a1/);
  assert.ok(message.html.includes('Summit &lt;2027&gt;'));
  assert.ok(!/firebase|project|tenant/i.test(message.text));
});

test('statusChangeMessage has words for every status after draft and refuses an unknown one', () => {
  assert.deepEqual(Object.keys(STATUS_WORDS).sort(), [
    'approved', 'build-failed', 'declined', 'launched', 'ready', 'withdrawn',
  ]);
  for (const status of Object.keys(STATUS_WORDS)) {
    assert.ok(statusChangeMessage({ ...change, status, note: null }).text.length > 0, status);
  }
  const accepted = statusChangeMessage({ ...change, status: 'approved', note: null }).text;
  assert.match(accepted, /accepted the agreement/);
  assert.match(accepted, /building your site/);
  assert.match(accepted, /email you when it is ready/);
  assert.match(statusChangeMessage({ ...change, status: 'build-failed', note: null }).text, /did not finish building/);
  assert.ok(!statusChangeMessage({ ...change, link: '' }).text.includes('Open your request'));
  assert.throws(() => statusChangeMessage({ ...change, status: 'lost' }), TypeError);
});

test('operatorNoticeMessage names the organization and the event', () => {
  const message = operatorNoticeMessage({ organizationName: 'NC Local', eventName: 'Summit', link: 'https://x.example/a', kind: 'started' });
  assert.equal(message.subject, 'Build started: Summit from NC Local');
  assert.match(message.text, /NC Local accepted the agreement for Summit\./);
});

test('operatorNoticeMessage says what happened to a build, and nothing about a payment', () => {
  const notice = { organizationName: 'NC Local', eventName: 'Summit', link: 'https://x.example/a' };
  const notStarted = operatorNoticeMessage({ ...notice, kind: 'build-failed' }).text;
  assert.match(notStarted, /build did not start/);
  const failed = operatorNoticeMessage({ ...notice, kind: 'build-run-failed', problem: 'Web address: no certificate.' });
  assert.match(failed.subject, /^Build failed:/);
  assert.match(failed.text, /Web address: no certificate\./);
  assert.match(failed.text, /Retry the build/);
  for (const text of [notStarted, failed.text]) assert.ok(!/pay/i.test(text), text);
});

const COPY = Object.freeze({
  to: 'ana@example.org',
  organizationName: 'NC Local',
  eventName: 'Summit',
  title: 'Test agreement',
  version: 3,
  body: 'First <b>test</b> paragraph.\nIts second line.\n\nSecond test paragraph.',
  sha256: 'abc123',
  typedName: 'Ana <Owner>',
  legalName: 'NC Local Inc.',
  signerTitle: 'Director',
  acceptedAt: '2026-11-04T15:00:00.000Z',
  link: 'https://x.example/a',
});

test('the agreement note says who accepted, when and which version, with escaped HTML and no text or hash', () => {
  const message = agreementCopyMessage(COPY);
  assert.equal(message.subject, 'Your copy of the agreement: Summit');
  for (const part of ['Agreement accepted', 'on behalf of NC Local Inc. for Summit.', 'Version: 3', 'Ana <Owner>, Director', 'November 4, 2026 at 10:00 AM EST', 'attached as a PDF', 'https://x.example/a']) {
    assert.ok(message.text.includes(part), part);
  }
  assert.ok(message.html.includes('Ana &lt;Owner&gt;, Director'));
  assert.ok(!message.html.includes('<Owner>'));
  assert.ok(message.html.includes('Event Runner'));
  for (const body of [message.text, message.html]) {
    assert.ok(!body.includes('abc123'));
    assert.ok(!body.includes('test</b> paragraph'));
    assert.ok(!body.includes('test&lt;/b&gt; paragraph'));
  }
  assert.ok(!agreementCopyMessage({ ...COPY, link: '' }).text.includes('Open your request'));
});

test('the Postmark mailer attaches the agreement as a PDF of its text and record', async () => {
  const bodies = [];
  const fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await createPostmarkMailer({ token: 't', from: 'a@b.example', fetch }).sendAgreementCopy(COPY);
  const [sent] = bodies;
  assert.equal(sent.Tag, 'console-agreement');
  assert.equal(sent.Attachments.length, 1);
  const [file] = sent.Attachments;
  assert.equal(file.ContentType, 'application/pdf');
  assert.equal(file.Name, 'Event Runner agreement, version 3.pdf');
  const pdf = await PDFDocument.load(Buffer.from(file.Content, 'base64'));
  assert.equal(pdf.getTitle(), 'Test agreement, version 3');
  assert.equal(pdf.getPageCount(), 1);
});

test('the agreement PDF runs to more pages for a long text and draws text outside its font', async () => {
  const body = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} of the test text, long enough to wrap onto a second line on the page. Nguyễn Văn 東京.`).join('\n\n');
  const pdf = await PDFDocument.load(await agreementPdf({ ...COPY, body, typedName: 'Nguyễn' }));
  assert.ok(pdf.getPageCount() >= 3);
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
