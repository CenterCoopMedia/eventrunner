'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { run, internals } = require('./verify-sender-domain.cjs');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');

function fakeDeps({ provider, db }) {
  return {
    getEmailProvider: () => provider,
    initFirebase: () => ({ db }),
  };
}

function dbWithSender(email) {
  const db = makeFakeDb();
  db.collection('config').doc('event').set({ sender: { email, domainVerified: false, domainVerifiedAt: null } });
  return db;
}

const PASS = {
  domain: 'example.org', verified: true, spf: 'pass', dkim: 'pass', returnPath: 'pass',
};
const FAIL = {
  domain: 'example.org', verified: false, spf: 'pass', dkim: 'fail', returnPath: 'unknown',
};

test('a verified domain exits 0 and stamps config/event.sender', async () => {
  const db = dbWithSender('hello@example.org');
  const code = await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({ provider: { name: 'postmark', verifySenderDomain: async () => PASS }, db }),
  });
  assert.equal(code, 0);
  const event = (await db.collection('config').doc('event').get()).data();
  assert.equal(event.sender.domainVerified, true);
  assert.ok(event.sender.domainVerifiedAt);
  assert.equal(event.sender.email, 'hello@example.org', 'the merge must not drop the address');
});

test('an unverified domain exits 1 and stamps nothing', async () => {
  const db = dbWithSender('hello@example.org');
  const code = await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({ provider: { name: 'postmark', verifySenderDomain: async () => FAIL }, db }),
  });
  assert.equal(code, 1);
  assert.equal((await db.collection('config').doc('event').get()).data().sender.domainVerified, false);
});

test('--no-write reports without stamping', async () => {
  const db = dbWithSender('hello@example.org');
  const code = await run({
    args: { 'no-write': true },
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({ provider: { name: 'postmark', verifySenderDomain: async () => PASS }, db }),
  });
  assert.equal(code, 0);
  assert.equal((await db.collection('config').doc('event').get()).data().sender.domainVerified, false);
});

test('the domain checked is the one the deployment sends from', async () => {
  const db = dbWithSender('hello@mail.example.org');
  let asked = null;
  await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({
      provider: { name: 'postmark', verifySenderDomain: async (d) => { asked = d; return PASS; } },
      db,
    }),
  });
  assert.equal(asked, 'mail.example.org');
});

test('a provider with no domain concept is "nothing to check", not a failure', async () => {
  const code = await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'console' },
    deps: fakeDeps({ provider: { name: 'console' }, db: makeFakeDb() }),
  });
  assert.equal(code, 0);
});

test('a misconfigured provider exits 2 rather than reporting a verdict', async () => {
  const code = await run({
    args: {},
    env: {},
    deps: {
      getEmailProvider: () => { throw new Error('EVENT_EMAIL_PROVIDER is not set'); },
      initFirebase: () => ({ db: makeFakeDb() }),
    },
  });
  assert.equal(code, 2);
});

test('a provider call that throws exits 2 — an error is not a "not verified" answer', async () => {
  const code = await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({
      provider: { name: 'postmark', verifySenderDomain: async () => { throw new Error('network down'); } },
      db: dbWithSender('hello@example.org'),
    }),
  });
  assert.equal(code, 2);
});

test('no sender domain anywhere exits 2 with a usable message', async () => {
  const code = await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({ provider: { name: 'postmark', verifySenderDomain: async () => PASS }, db: makeFakeDb() }),
  });
  assert.equal(code, 2);
});

test('the output names each failing record and what to publish', () => {
  const remediation = internals.remediation(FAIL);
  assert.match(remediation, /DKIM/);
  assert.match(remediation, /return-path/i);
  assert.match(remediation, /DMARC/);
  assert.match(internals.formatStatus(FAIL), /DKIM:\s+FAIL/);
});
