'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { consentEventMount, manageEventMount } = require('./clientHostEnrollment.cjs');
const { closeApplication, declineApplication } = require('./reviewDecisions.cjs');
const { withdrawApplication } = require('./applicationStatus.cjs');
const { getApplication } = require('./applications.cjs');
const { recordAppliedPublicBase } = require('./clientHostRecords.cjs');
const { saveApplicationStep } = require('./applicationSave.cjs');
const { checkWebAddress } = require('./siteNames.cjs');
const { ana, application, deps, ops, seeded } = require('./fakeReview.cjs');

const otherOwner = { uid: 'cy', email: 'cy@example.org' };
const editor = { uid: 'ben', email: 'ben@example.org' };
const host = 'nclocal.eventrunner.org';
const publicBase = `https://${host}/summit-2027/`;
const siblingBase = `https://${host}/events/workshops/`;
const verified = { authorityReference: 'fixture/host-approval-1', confirmAuthority: true };

function setup(extra = {}) {
  return deps(seeded({
    'organizations/o2': { name: 'NC Local' },
    'organizations/o2/members/cy': { role: 'owner', email: otherOwner.email },
    'applications/a1': application({ status: 'launched', agreementAcceptance: { id: 'aa1' } }),
    'applications/a2': application({ orgId: 'o2', status: 'ready', agreementAcceptance: { id: 'aa2' } }),
    'console_builds/a1': { state: 'done', resources: { projectId: 'er-summit', site: 'summit-host', environment: 'nclocal' } },
    'console_builds/a2': { state: 'done', resources: { projectId: 'er-workshops', site: 'workshops-host', environment: 'workshops' } },
    'site_names/workshops': { appId: 'a2', orgId: 'o2' },
    'agreement_acceptances/aa1': { appId: 'a1' },
    'agreement_acceptances/aa2': { appId: 'a2' },
    'signup_links/l1': { appId: 'a1', status: 'used' },
    'signup_links/l2': { appId: 'a2', status: 'used' },
    ...extra,
  }));
}

function consent(d, { appId = 'a1', orgId = 'o1', url = publicBase, user = ana, confirm = true } = {}) {
  return consentEventMount(d, { body: { appId, orgId, publicBase: url, confirm }, user });
}

function manage(d, action, fields = {}, user = ops) {
  return manageEventMount(d, { body: { action, appId: 'a1', publicBase, ...fields }, user });
}

test('consent requires the application’s own authenticated Owner and enrollment requires a host receipt', async () => {
  const d = setup();
  await assert.rejects(consent(d, { user: editor }), { code: 'forbidden' });
  await assert.rejects(consent(d, { user: ops }), { code: 'not-found' });
  await assert.rejects(consent(d, { appId: 'a2' }), { code: 'not-found' });
  await assert.rejects(consent(d, { confirm: false }), { code: 'confirm-required' });
  await assert.rejects(manage(d, 'enroll', verified, ana), { code: 'not-operator' });
  await assert.rejects(manage(d, 'enroll', verified), { code: 'mount-conflict' });
  await consent(d, { url: publicBase.slice(0, -1) });
  await assert.rejects(manage(d, 'enroll'), { code: 'mount-conflict' });
  await assert.rejects(manage(d, 'enroll', { ...verified, publicBase: siblingBase }), { code: 'mount-conflict' });
  await d.db.collection('organizations/o1/members').doc(ana.uid).update({ role: 'editor' });
  await assert.rejects(manage(d, 'enroll', verified), { code: 'forbidden' });
  assert.deepEqual(d.db.paths('console_event_mounts/'), []);
  assert.deepEqual(d.db.paths('console_client_hosts/'), []);
});

test('an existing web-address holder enrolls first, then a separately owned event can join', async () => {
  const d = setup();
  await consent(d);
  await consent(d, { appId: 'a2', orgId: 'o2', url: siblingBase, user: otherOwner });
  await assert.rejects(manage(d, 'enroll', { ...verified, appId: 'a2', publicBase: siblingBase }), { code: 'mount-conflict' });
  const stable = ['console_builds/a1', 'console_builds/a2', 'site_names/nclocal', 'site_names/workshops', 'agreement_acceptances/aa1',
    'agreement_acceptances/aa2', 'signup_links/l1', 'signup_links/l2', 'organizations/o1', 'organizations/o2'];
  const before = stable.map(d.db.read);
  const first = (await manage(d, 'enroll', verified)).body.route;
  assert.deepEqual((await manage(d, 'enroll')).body.route, first);
  await manage(d, 'enroll', { appId: 'a2', publicBase: siblingBase });
  assert.equal(first.projectId, 'er-summit');
  assert.equal(first.hostingOrigin, 'https://summit-host.web.app');
  assert.equal(first.mount, '/summit-2027');
  assert.equal(d.db.read('console_event_mounts/a2').projectId, 'er-workshops');
  assert.equal(d.db.read('console_event_mounts/a2').hostingOrigin, 'https://workshops-host.web.app');
  assert.equal(d.db.read('console_event_mounts/a2').consent.by, otherOwner.uid);
  assert.equal(d.db.read(`console_client_hosts/${host}`).authority.reference, verified.authorityReference);
  assert.equal((await manage(d, 'get')).body.route.state, 'enrolled');
  await assert.rejects(consent(d, { url: `https://${host}/another/` }), { code: 'mount-conflict' });
  assert.deepEqual(stable.map(d.db.read), before);
  assert.equal(d.mailer.sent.length, 0);
});

test('publication and removal change only the selected event’s public address', async () => {
  const d = setup();
  await consent(d);
  await consent(d, { appId: 'a2', orgId: 'o2', url: siblingBase, user: otherOwner });
  await manage(d, 'enroll', verified);
  await manage(d, 'enroll', { appId: 'a2', publicBase: siblingBase });
  const ownerView = async () => (await getApplication(d, { body: { orgId: 'o1', appId: 'a1' }, user: ana })).body.application;
  assert.equal((await ownerView()).publicBase, undefined);
  await assert.rejects(manage(d, 'publish'), { code: 'confirm-required' });
  await assert.rejects(manage(d, 'publish', { confirm: true }, ana), { code: 'not-operator' });
  await manage(d, 'publish', { confirm: true });
  await manage(d, 'publish', { appId: 'a2', publicBase: siblingBase, confirm: true });
  assert.equal((await ownerView()).publicBase, undefined);
  const identity = { appId: 'a1', projectId: 'er-summit', site: 'summit-host', domain: host };
  await recordAppliedPublicBase(d.db, identity, publicBase);
  assert.equal((await ownerView()).publicBase, publicBase);
  const sibling = d.db.read('console_event_mounts/a2');
  await manage(d, 'remove', { confirm: true });
  assert.equal((await ownerView()).publicBase, publicBase);
  await recordAppliedPublicBase(d.db, identity, 'https://summit-host.web.app');
  assert.equal((await ownerView()).publicBase, 'https://summit-host.web.app');
  assert.equal(d.db.read('console_event_mounts/a1').publicBase, publicBase);
  assert.deepEqual(d.db.read('console_event_mounts/a2'), sibling);
  await assert.rejects(manage(d, 'publish', { confirm: true }), { code: 'mount-conflict' });
  await d.db.doc('organizations/o1/members/ana').update({ role: 'editor' });
  await assert.rejects(manage(d, 'enroll'), { code: 'forbidden' });
  await consent(d, { user: { uid: 'bo', email: 'bo@example.org' } });
  const renewed = (await manage(d, 'enroll')).body.route;
  assert.equal(renewed.state, 'enrolled');
  assert.equal(renewed.consent.by, 'bo');
});

test('reserved paths, overlapping mounts and incompatible hosts are refused', async () => {
  const d = setup();
  for (const url of [
    `https://${host}/`, `https://${host}/__/auth`, `https://${host}/api/event/`, `https://${host}/robots.txt`,
    `https://${host}/mount/%2F`, `https://${host}/mount/../other`, `https://${host}:8443/event/`,
    'https://console.eventrunner.org/event/', 'https://summit-host.web.app/event/', 'https://127.0.0.1/event/',
  ]) await assert.rejects(consent(d, { url }), { code: 'invalid-mount' });
  await consent(d);
  await manage(d, 'enroll', verified);
  for (const url of [publicBase, `${publicBase}another/`]) {
    await consent(d, { appId: 'a2', orgId: 'o2', url, user: otherOwner });
    await assert.rejects(manage(d, 'enroll', { appId: 'a2', publicBase: url }), { code: 'mount-conflict' });
  }
  const similar = `https://${host}/summit-2027-old/`;
  await consent(d, { appId: 'a2', orgId: 'o2', url: similar, user: otherOwner });
  await manage(d, 'enroll', { appId: 'a2', publicBase: similar });
});

test('an approved new managed host stays separate from event web-address reservations', async () => {
  const d = setup({ 'applications/draft': application({ status: 'draft' }) });
  const url = 'https://client-events.eventrunner.org/summit/';
  await consent(d, { url });
  await manage(d, 'enroll', { ...verified, publicBase: url });
  assert.equal(d.db.read('site_names/client-events'), undefined);
  assert.equal((await checkWebAddress(d, { body: { name: 'client-events', appId: 'draft' } })).body.available, false);
  const result = await saveApplicationStep(d, {
    body: { appId: 'draft', orgId: 'o1', step: 'webAddress', answers: { name: 'client-events' } }, user: ana,
  });
  assert.equal(result.body.saved, false);
  assert.equal(d.db.read('site_names/nclocal').appId, 'a1');
});

test('decline and withdrawal discard pending consent while a failed build’s closure removes only its route', async () => {
  const d = setup({
    'applications/a2': application({ orgId: 'o2', status: 'building' }),
    'console_builds/a2': { state: 'failed', resources: { projectId: 'er-workshops', site: 'workshops-host' } },
    'applications/withdrawn': application({ status: 'draft' }),
    'applications/declined': application({ status: 'draft' }),
  });
  await consent(d);
  await manage(d, 'enroll', verified);
  const enrolled = d.db.read('console_event_mounts/a1');
  for (const appId of ['withdrawn', 'declined']) await consent(d, { appId, url: siblingBase });
  await withdrawApplication(d, { body: { appId: 'withdrawn', orgId: 'o1' }, user: ana });
  await declineApplication(d, { body: { appId: 'declined', revision: 2, note: 'Fixture.' }, user: ops });
  assert.equal(d.db.read('applications/withdrawn').eventMountConsent, null);
  assert.equal(d.db.read('applications/declined').eventMountConsent, null);
  await consent(d, { appId: 'a2', orgId: 'o2', url: siblingBase, user: otherOwner });
  await manage(d, 'enroll', { appId: 'a2', publicBase: siblingBase });
  await closeApplication(d, { body: { appId: 'a2', revision: 2, note: 'Fixture.' }, user: ops });
  assert.equal(d.db.read('console_event_mounts/a2').state, 'removed');
  assert.deepEqual(d.db.read('console_event_mounts/a1'), enrolled);
  assert.equal(d.db.read('site_names/nclocal').appId, 'a1');
});
