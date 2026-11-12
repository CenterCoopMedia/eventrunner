'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main, readArgs, readAddress, updateSettings } = require('./set-client-email.cjs');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');

const ACTOR = 'operator@example.org';
const ENV = { EVENT_FIREBASE_PROJECT_ID: 'demo-client-email' };
const AT = new Date('2026-11-12T00:00:00Z');
const EVENT = {
  name: 'Example event',
  sender: { email: 'old@example.org', name: 'Example team', replyTo: 'help@example.org', domainVerified: true, domainVerifiedAt: '2026-10-01', domainVerifiedBy: 'provider', domainVerifiedDomain: 'example.org' },
  legal: { postalAddressHtml: '[Replace address]', operatorName: 'Example Org', supportEmail: 'help@example.org', reviewRequired: false },
};

function addressFile(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-email-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'address.txt');
  fs.writeFileSync(file, content);
  return file;
}

test('the address input is plain text, escaped for the existing HTML footer', (t) => {
  assert.equal(readAddress(addressFile(t, ' Example & Co\r\n1 <Main> Street\r\n ')), 'Example &amp; Co<br>1 &lt;Main&gt; Street');
  for (const input of ['', ' \n ', '[Replace address]', '\0address', Buffer.from([0xff]), 'a'.repeat(8193)]) {
    assert.throws(() => readAddress(addressFile(t, input)));
  }
});

test('sender input is a bare mailbox and every operation names its actor', () => {
  assert.deepEqual(readArgs(['--actor', ACTOR, '--sender-email', 'new@example.org', '--dry-run']), { actor: ACTOR, senderEmail: 'new@example.org', dryRun: true });
  for (const argv of [[], ['--actor', ACTOR], ['--sender-email', 'new@example.org'], ['--actor', ACTOR, '--sender-email', 'Name <new@example.org>'], ['--actor', ACTOR, '--sender-email', 'a@example.org\nBcc:b@example.org'], ['--actor', ACTOR, '--address-file'], ['--actor', ACTOR, '--from', 'new@example.org']]) {
    assert.throws(() => readArgs(argv));
  }
});

test('a change preserves other config and writes one atomic audit row', async () => {
  const db = makeFakeDb({ 'config/event': EVENT });
  const fields = await updateSettings({ db, mode: 'application-default', now: () => AT, plan: { actor: ACTOR, senderEmail: 'new@example.org', postalAddressHtml: 'Example Org<br>1 Main Street' } });
  assert.deepEqual(fields, ['sender.email', 'legal.postalAddressHtml']);
  const saved = (await db.collection('config').doc('event').get()).data();
  assert.equal(saved.name, EVENT.name);
  assert.deepEqual(saved.legal, { ...EVENT.legal, postalAddressHtml: 'Example Org<br>1 Main Street' });
  assert.deepEqual(saved.sender, { ...EVENT.sender, email: 'new@example.org', domainVerified: false, domainVerifiedAt: null, domainVerifiedBy: null, domainVerifiedDomain: null });
  assert.equal(saved.updatedBy, ACTOR);
  const rows = await db.collection('admin_logs').get();
  assert.equal(rows.size, 1);
  const audit = rows.docs[0].data();
  assert.equal(audit.action, 'updateClientEmailSettings');
  assert.equal(audit.email, ACTOR);
  assert.deepEqual(audit.details, { via: 'script', credentials: 'application-default', fields });
  assert.doesNotMatch(JSON.stringify(audit), /1 Main Street|old@example.org|new@example.org/);
});

test('address-only changes preserve a concurrently verified sender', async () => {
  const db = makeFakeDb({ 'config/event': EVENT });
  db.beforeCommit = () => db.collection('config').doc('event').update({ sender: { ...EVENT.sender, domainVerifiedAt: '2026-11-11', name: 'Updated team' } });
  await updateSettings({ db, mode: 'service-account', plan: { actor: ACTOR, senderEmail: 'OLD@EXAMPLE.ORG', postalAddressHtml: 'Example Org<br>1 Main Street' } });
  const saved = (await db.collection('config').doc('event').get()).data();
  assert.equal(saved.sender.email, 'old@example.org');
  assert.equal(saved.sender.domainVerified, true);
  assert.equal(saved.sender.domainVerifiedAt, '2026-11-11');
  assert.equal(saved.sender.name, 'Updated team');
  assert.equal((await db.collection('admin_logs').get()).size, 1);
});

test('an aborted transaction leaves both config and audit unchanged', async () => {
  const db = makeFakeDb({ 'config/event': EVENT });
  db.beforeCommit = () => { throw new Error('commit refused'); };
  await assert.rejects(updateSettings({ db, mode: 'application-default', plan: { actor: ACTOR, senderEmail: 'new@example.org' } }));
  assert.deepEqual((await db.collection('config').doc('event').get()).data(), EVENT);
  assert.equal((await db.collection('admin_logs').get()).size, 0);
});

test('a dry run reads the named project and writes neither config nor audit', async (t) => {
  const db = makeFakeDb({ 'config/event': EVENT });
  const out = [];
  const code = await main(['--actor', ACTOR, '--sender-email', 'new@example.org', '--address-file', addressFile(t, 'Example Org\n1 Main Street'), '--dry-run'], {
    env: ENV, stdout: (line) => out.push(line), stderr: (line) => out.push(line),
    init: ({ env }) => { assert.equal(env.EVENT_FIREBASE_PROJECT_ID, 'demo-client-email'); return { db, projectId: env.EVENT_FIREBASE_PROJECT_ID, mode: 'application-default' }; },
  });
  assert.equal(code, 0, out.join('\n'));
  assert.deepEqual((await db.collection('config').doc('event').get()).data(), EVENT);
  assert.equal((await db.collection('admin_logs').get()).size, 0);
  assert.equal(out.join('\n'), 'Preview project demo-client-email: sender.email, legal.postalAddressHtml.');
});

test('invalid input and a missing project stop before credentials are initialized', async (t) => {
  let initialized = false;
  const init = () => { initialized = true; throw new Error('not reached'); };
  const file = addressFile(t, '[Replace with address]');
  for (const [argv, env] of [[['--actor', ACTOR, '--sender-email', 'new@example.org'], {}], [['--actor', ACTOR, '--address-file', file], ENV]]) {
    assert.equal(await main(argv, { env, init, stdout() {}, stderr() {} }), 2);
  }
  assert.equal(initialized, false);
});

test('unchanged settings do not create audit noise, and SDK details stay private', async () => {
  const db = makeFakeDb({ 'config/event': EVENT });
  assert.deepEqual(await updateSettings({ db, mode: 'application-default', plan: { actor: ACTOR, senderEmail: 'old@example.org' } }), []);
  assert.equal((await db.collection('admin_logs').get()).size, 0);
  const errors = [];
  assert.equal(await main(['--actor', ACTOR, '--sender-email', 'new@example.org'], { env: ENV, init: () => { throw new Error('synthetic-private-canary'); }, stdout() {}, stderr: (line) => errors.push(line) }), 1);
  assert.doesNotMatch(errors.join('\n'), /synthetic-private-canary/);
});
