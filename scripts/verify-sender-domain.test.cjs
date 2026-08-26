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
  const db = dbWithSender('hello@example.org');
  const code = await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'webhook' },
    deps: fakeDeps({ provider: { name: 'webhook' }, db }),
  });
  assert.equal(code, 0);
  assert.equal((await db.collection('config').doc('event').get()).data().sender.domainVerified, false);
});

test('a provider with no domain API can still satisfy readiness, by operator attestation', async () => {
  // Without this, EVENT_EMAIL_PROVIDER=webhook could never clear the
  // launch-readiness sender row: the provider exposes nothing to query, so
  // the gate would be unclearable and every webhook deployment
  // permanently unlaunchable — which teaches operators to ignore gates.
  const db = dbWithSender('hello@example.org');
  const code = await run({
    args: { attest: true },
    env: { EVENT_EMAIL_PROVIDER: 'webhook' },
    deps: fakeDeps({ provider: { name: 'webhook' }, db }),
  });
  assert.equal(code, 0);
  const sender = (await db.collection('config').doc('event').get()).data().sender;
  assert.equal(sender.domainVerified, true);
  assert.equal(sender.domainVerifiedBy, 'operator-attested', 'the record says whose word this is');
  assert.ok(sender.domainVerifiedAt);
});

test('a capable provider refuses --attest — its own check is the answer', async () => {
  const db = dbWithSender('hello@example.org');
  const code = await run({
    args: { attest: true },
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({ provider: { name: 'postmark', verifySenderDomain: async () => PASS }, db }),
  });
  assert.equal(code, 2);
  assert.equal((await db.collection('config').doc('event').get()).data().sender.domainVerified, false);
});

test('a definitive failure clears a stale stored verification', async () => {
  // Otherwise --check would report a launch as ready on a stamp that a
  // live DNS answer has just contradicted.
  const db = dbWithSender('hello@example.org');
  await db.collection('config').doc('event').set(
    { sender: { email: 'hello@example.org', domainVerified: true, domainVerifiedAt: '2027-01-01T00:00:00Z' } },
  );
  const code = await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({ provider: { name: 'postmark', verifySenderDomain: async () => FAIL }, db }),
  });
  assert.equal(code, 1);
  const sender = (await db.collection('config').doc('event').get()).data().sender;
  assert.equal(sender.domainVerified, false);
  assert.equal(sender.domainVerifiedAt, null);
});

test('an inconclusive check does NOT clear a stored verification', async () => {
  // "No account token, everything unknown" says nothing about the domain;
  // silently un-verifying a fine deployment would be its own bug.
  const db = dbWithSender('hello@example.org');
  await db.collection('config').doc('event').set(
    { sender: { email: 'hello@example.org', domainVerified: true, domainVerifiedAt: '2027-01-01T00:00:00Z' } },
  );
  const unknown = {
    domain: 'example.org', verified: false, spf: 'unknown', dkim: 'unknown', returnPath: 'unknown',
    detail: 'EMAIL_ACCOUNT_API_KEY not configured',
  };
  const code = await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({ provider: { name: 'postmark', verifySenderDomain: async () => unknown }, db }),
  });
  assert.equal(code, 1);
  assert.equal((await db.collection('config').doc('event').get()).data().sender.domainVerified, true);
});

test('a definitive failure on some OTHER domain leaves the stored verification alone', async () => {
  const db = dbWithSender('hello@example.org');
  await db.collection('config').doc('event').set(
    { sender: { email: 'hello@example.org', domainVerified: true, domainVerifiedAt: '2027-01-01T00:00:00Z' } },
  );
  const code = await run({
    args: { domain: 'other.example' },
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({
      provider: { name: 'postmark', verifySenderDomain: async () => ({ ...FAIL, domain: 'other.example' }) },
      db,
    }),
  });
  assert.equal(code, 1);
  assert.equal((await db.collection('config').doc('event').get()).data().sender.domainVerified, true);
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

test('remediation never tells an operator to publish an SPF record', () => {
  // Postmark satisfies SPF through the return-path CNAME (issue #93);
  // sending someone to add an SPF record is a chase that cannot change the
  // verdict. A non-passing SPF earns a note saying exactly that instead.
  const spfDown = { ...FAIL, spf: 'fail', dkim: 'pass', returnPath: 'pass' };
  const remediation = internals.remediation(spfDown);
  assert.doesNotMatch(remediation, /Publish the provider SPF record/);
  assert.doesNotMatch(remediation, /- Publish[^\n]*SPF/);
  assert.match(remediation, /SPF needs no action/);
  assert.match(remediation, /return-path CNAME/);
  assert.match(internals.formatStatus(spfDown), /SPF:\s+FAIL\s+\(informational/);
});

test('a failing SPF alone is not a definitive failure', () => {
  // The gate is DKIM + return-path; SPF is reported, never decisive, so it
  // must not tear down a stored verification on its own.
  assert.equal(
    internals.isDefinitiveFailure({ spf: 'fail', dkim: 'pass', returnPath: 'pass' }),
    false,
  );
  assert.equal(
    internals.isDefinitiveFailure({ dkim: 'pass', returnPath: 'fail' }),
    true,
    'an absent SPF field must not break the check either',
  );
});

test('DKIM + return-path passing is verified even with SPF unresolved', async () => {
  // The end-to-end shape of issue #93: the provider says verified with SPF
  // still unknown, and the script stamps rather than stalling.
  const db = dbWithSender('hello@example.org');
  const spfUnknown = {
    domain: 'example.org', verified: true, spf: 'unknown', dkim: 'pass', returnPath: 'pass',
  };
  const code = await run({
    args: {},
    env: { EVENT_EMAIL_PROVIDER: 'postmark' },
    deps: fakeDeps({ provider: { name: 'postmark', verifySenderDomain: async () => spfUnknown }, db }),
  });
  assert.equal(code, 0);
  const sender = (await db.collection('config').doc('event').get()).data().sender;
  assert.equal(sender.domainVerified, true);
  assert.equal(sender.domainVerifiedBy, 'provider-check');
});
