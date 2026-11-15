'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSiteHealth } = require('./siteHealth.cjs');
const { NOW, seededDb, applicationDoc, fakeMailer, quietLog } = require('./testData.cjs');

test('checks site and admin, sends one operator alert per outage and rearms after recovery', async () => {
  const db = seededDb({ 'applications/a1': applicationDoc({ status: 'launched' }),
    'console_builds/a1': { resources: { domain: 'nclocal.eventrunner.org' } } });
  const mailer = fakeMailer();
  let failed = true;
  const urls = [];
  const deps = { db, mailer, log: quietLog(), publicUrl: 'https://console.example.org', now: () => NOW,
    fetch: async (url, options) => { urls.push(url); assert.equal(options.redirect, 'manual'); return new Response('', { status: failed && url.endsWith('/admin/') ? 503 : 200 }); } };
  await checkSiteHealth(deps);
  assert.deepEqual(urls, ['https://nclocal.eventrunner.org/', 'https://nclocal.eventrunner.org/admin/']);
  assert.equal(db.read('console_builds/a1').health.admin.ok, false);
  assert.equal(mailer.sent.length, 2, 'one separate email to each operator');
  await checkSiteHealth(deps);
  assert.equal(mailer.sent.length, 2);
  failed = false;
  await checkSiteHealth(deps);
  failed = true;
  await checkSiteHealth(deps);
  assert.equal(mailer.sent.length, 4);
});

test('does not request untrusted domains or archived sites and never stores response text', async () => {
  const db = seededDb({ 'applications/a1': applicationDoc({ status: 'archived' }),
    'console_builds/a1': { resources: { domain: 'nclocal.eventrunner.org' } },
    'applications/a2': applicationDoc({ status: 'ready' }), 'console_builds/a2': { resources: { domain: 'localhost/private' } },
    'applications/a3': applicationDoc({ status: 'ready' }), 'console_builds/a3': { resources: { domain: 'valid.eventrunner.org' } } });
  const urls = [];
  await checkSiteHealth({ db, mailer: fakeMailer(), log: quietLog(), now: () => NOW,
    fetch: async (url) => { urls.push(url); throw new Error('untrusted private error'); } });
  assert.deepEqual(urls, ['https://valid.eventrunner.org/', 'https://valid.eventrunner.org/admin/']);
  assert.ok(!JSON.stringify(db.read('console_builds/a3')).includes('untrusted'));
});

test('a failed recipient is retried without repeating an already delivered outage notice', async () => {
  const db = seededDb({ 'applications/a1': applicationDoc({ status: 'launched' }),
    'console_builds/a1': { resources: { domain: 'nclocal.eventrunner.org' } } });
  const delivered = [];
  let attempts = 0;
  let at = NOW;
  const deps = { db, log: quietLog(), publicUrl: 'https://console.example.org', now: () => at,
    fetch: async () => new Response('', { status: 503 }), mailer: { sendOperatorNotice: async (message) => {
      attempts += 1;
      assert.equal(message.link, 'https://console.example.org/review/deployments');
      if (message.to === 'two@ccm.example') throw new Error('recipient refused');
      delivered.push(message.to);
    } } };
  await checkSiteHealth(deps);
  at += 15 * 60_000;
  await checkSiteHealth(deps);
  assert.deepEqual(delivered, ['ops@ccm.example']);
  assert.equal(attempts, 3);
  assert.deepEqual(db.read('console_builds/a1').health.notifiedTo, ['ops@ccm.example']);
});
