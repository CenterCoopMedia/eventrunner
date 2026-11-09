'use strict';

// The operator's add command, with fake Hosting, sign-in and Firestore.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../functions/src/cms/firestoreFake.cjs');
const { run, withUserProject } = require('./add-web-address.cjs');

const ENV = { EVENT_FIREBASE_PROJECT_ID: 'example-event' };
const RECORDS = [
  { action: 'add', type: 'A', host: 'summit.example.org', value: '199.36.158.100' },
  { action: 'remove', type: 'A', host: 'summit.example.org', value: '10.0.0.1' },
];
const STORED = { domain: 'summit.example.org', state: 'records', records: RECORDS, lastCheckedAt: null };

function setup({ seed = {}, records = RECORDS } = {}) {
  const calls = [];
  const db = makeFakeDb(seed);
  const hosting = { async addDomain(domain) { calls.push(['hosting', domain]); return { records }; } };
  const identity = { async addAuthorizedDomain(domain) { calls.push(['sign-in', domain]); } };
  const out = [];
  const err = [];
  const go = (argv, env = ENV) => run({ argv, env, clients: () => ({ db, hosting, identity }), log: (line) => out.push(line), error: (line) => err.push(line) });
  return { db, hosting, identity, calls, out, err, go };
}

test('adding a domain stores the record and prints the records and what happens next', async () => {
  const { db, calls, out, go } = setup();
  assert.equal(await go(['Summit.Example.org']), 0);
  // Sign-in waits for the check to find the domain served.
  assert.deepEqual(calls, [['hosting', 'summit.example.org']]);
  assert.equal(db.read('web_address', 'current').state, 'records');
  const text = out.join('\n');
  assert.match(text, /Add {2}A {2}summit\.example\.org {2}199\.36\.158\.100/);
  assert.match(text, /Remove {2}A {2}summit\.example\.org {2}10\.0\.0\.1/);
  assert.match(text, /first check that finds it served adds summit\.example\.org to the sign-in authorized domains/);
  assert.match(text, /hourly check and Check now/);
  assert.match(text, /remove-web-address\.cjs summit\.example\.org/);
});

test('when Hosting has no records yet, the operator is told where they appear', async () => {
  const { out, go } = setup({ records: [] });
  assert.equal(await go(['summit.example.org']), 0);
  assert.match(out.join('\n'), /still preparing the DNS records/);
});

test('a dry run validates and changes nothing', async () => {
  const { db, calls, out, go } = setup();
  assert.equal(await go(['summit.example.org', '--dry-run']), 0);
  assert.deepEqual(calls, []);
  assert.equal(db.read('web_address', 'current'), undefined);
  assert.match(out.join('\n'), /Dry run\. Nothing was changed/);
  assert.equal(await go(['https://summit.example.org', '--dry-run']), 1);
});

test('a bad domain, a missing project or an unknown flag is refused before any call', async () => {
  const { calls, err, go } = setup();
  assert.equal(await go(['https://summit.example.org/path']), 1);
  assert.match(err.pop(), /plain domain/);
  assert.equal(await go(['event.eventrunner.org']), 1);
  assert.equal(await go(['summit.example.org'], {}), 1);
  assert.equal(await go(['summit.example.org', '--force']), 1);
  assert.equal(await go([]), 1);
  assert.deepEqual(calls, []);
});

test('another stored domain is refused; the same one is a no-op', async () => {
  const other = setup({ seed: { 'web_address/current': STORED } });
  assert.equal(await other.go(['other.example.org']), 1);
  assert.match(other.err.join('\n'), /already has summit\.example\.org stored\. Remove it first/);
  assert.deepEqual(other.calls, []);

  const same = setup({ seed: { 'web_address/current': STORED } });
  assert.equal(await same.go(['summit.example.org']), 0);
  assert.match(same.out.join('\n'), /already stored \(status: records\)\. Nothing changed/);
  assert.deepEqual(same.calls, []);
  assert.deepEqual(same.db.read('web_address', 'current'), STORED);
});

test('an unfinished removal must be finished first', async () => {
  const { calls, err, go } = setup({ seed: { 'web_address/current': { ...STORED, state: 'removing' } } });
  assert.equal(await go(['summit.example.org']), 1);
  assert.match(err.join('\n'), /removal of summit\.example\.org did not finish/);
  assert.deepEqual(calls, []);
});

test('a failure part way stores nothing, and running the same command again finishes it', async () => {
  const { db, hosting, err, go } = setup();
  const add = hosting.addDomain;
  hosting.addDomain = async () => { throw new Error('Google API answered 403'); };
  assert.equal(await go(['summit.example.org']), 1);
  assert.match(err.join('\n'), /did not finish \(Google API answered 403\)\. Nothing is stored yet\. Run the same command again/);
  assert.equal(db.read('web_address', 'current'), undefined);

  hosting.addDomain = add;
  assert.equal(await go(['summit.example.org']), 0);
  assert.equal(db.read('web_address', 'current').domain, 'summit.example.org');
});

test('Google calls name the client project for quota', async () => {
  const seen = [];
  const fetchImpl = withUserProject('example-event', async (url, init) => { seen.push(init.headers); return { ok: true }; });
  await fetchImpl('https://firebasehosting.googleapis.com/v1beta1/x', { headers: { authorization: 'Bearer token' } });
  assert.deepEqual(seen, [{ authorization: 'Bearer token', 'x-goog-user-project': 'example-event' }]);
});
