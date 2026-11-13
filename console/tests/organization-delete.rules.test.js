// The operator deletion contract on real Firestore transactions. No production access.
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { deleteOrganization } = require('../functions/src/organizationDelete.cjs');
const { makeFakeSecrets } = require('../functions/src/fakes.cjs');
const PROJECT_ID = 'demo-console-organization-delete';
const ops = { uid: 'ops', email: 'ops@example.test' };
const at = new Date('2026-11-13T12:00:00Z');
let environment;
let admin;
let db;
let secrets;

const request = (status = 'draft', extra = {}) => ({ orgId: 'unused', status, history: [{ status: 'draft' }], ...extra });
const input = { body: { orgId: 'unused', confirm: true }, user: ops };
const deps = () => ({ db, secrets, now: () => at.getTime(), log: { error() {} } });

async function seed(records) {
  const batch = db.batch();
  for (const [path, data] of Object.entries(records)) batch.set(db.doc(path), data);
  await batch.commit();
}

beforeAll(async () => {
  // This suite must fail rather than fall through to a real project.
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore emulator required');
  environment = await initializeTestEnvironment({ projectId: PROJECT_ID });
  admin = initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
  db = getFirestore(admin);
});
beforeEach(async () => {
  await environment.clearFirestore();
  secrets = makeFakeSecrets();
  await seed({
    'console_config/operators': { emails: [ops.email] },
    'organizations/unused': { name: 'Unused test organization' },
    'organizations/unused/members/owner': { uid: 'owner', role: 'owner', email: 'owner@example.test' },
    'organizations/unused/members/editor': { uid: 'editor', role: 'editor', email: 'editor@example.test' },
    'applications/draft': request(),
  });
});
afterAll(async () => {
  await db?.terminate();
  if (admin) await deleteApp(admin);
  await environment?.cleanup();
});

describe('operator deletion of an unused organization', () => {
  it.each(['approved', 'building', 'ready', 'launched', 'archived', 'unknown'])('refuses a %s request without deleting anything', async (status) => {
    await seed({ 'applications/draft': request(status) });
    await expect(deleteOrganization(deps(), input)).rejects.toMatchObject({ status: 409, code: 'organization-in-use' });
    expect((await db.doc('organizations/unused').get()).exists).toBe(true);
    expect((await db.doc('applications/draft').get()).data().status).toBe(status);
    expect((await db.collection('console_audit').get()).empty).toBe(true);
  });

  it.each(['approved', 'building', 'ready', 'launched'])('refuses a declined request that was once %s', async (status) => {
    await seed({ 'applications/draft': request('declined', { history: [{ status: 'draft' }, { status }, { status: 'declined' }] }) });
    await expect(deleteOrganization(deps(), input)).rejects.toMatchObject({ code: 'organization-in-use' });
  });

  it.each([
    { frozen: { event: { name: 'Accepted event' } } },
    { agreementAcceptance: { id: 'acceptance' } },
    { submittedAt: at },
    { buildStart: { state: 'failed', at } },
    { review: { settings: { projectId: 'client-project' } } },
  ])('refuses persisted acceptance or project evidence %#', async (extra) => {
    await seed({ 'applications/draft': request('declined', extra) });
    await expect(deleteOrganization(deps(), input)).rejects.toMatchObject({ code: 'organization-in-use' });
  });

  it('refuses any build record, even an empty one on a withdrawn request', async () => {
    await seed({ 'applications/draft': request('withdrawn'), 'console_builds/draft': {} });
    await expect(deleteOrganization(deps(), input)).rejects.toMatchObject({ code: 'organization-in-use' });
    expect((await db.doc('console_builds/draft').get()).exists).toBe(true);
  });

  it('refuses approval evidence retained after the old request was removed', async () => {
    await seed({ 'agreement_acceptances/old': { orgId: 'unused', appId: 'removed', at } });
    await expect(deleteOrganization(deps(), input)).rejects.toMatchObject({ code: 'organization-in-use' });
  });

  it.each(['owner', 'editor', 'stranger'])('refuses a non-operator %s', async (uid) => {
    await expect(deleteOrganization(deps(), { ...input, user: { uid, email: `${uid}@example.test` } })).rejects.toMatchObject({ status: 403, code: 'not-operator' });
    expect((await db.doc('organizations/unused').get()).exists).toBe(true);
  });

  it('requires explicit confirmation and a valid existing organization', async () => {
    for (const confirm of [false, undefined, 'true']) {
      await expect(deleteOrganization(deps(), { ...input, body: { orgId: 'unused', confirm } })).rejects.toMatchObject({ code: 'confirm-required' });
    }
    await expect(deleteOrganization(deps(), { ...input, body: { orgId: 'bad/id', confirm: true } })).rejects.toMatchObject({ status: 400 });
    await expect(deleteOrganization(deps(), { ...input, body: { orgId: 'missing', confirm: true } })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an account change in progress', async () => {
    await seed({ 'applications/draft': request('draft', { connections: { stripe: { change: { until: new Date(at.getTime() + 60000) } } } }) });
    await expect(deleteOrganization(deps(), input)).rejects.toMatchObject({ code: 'connection-busy' });
  });

  it('deletes every related record, keeps other organizations, and writes only the minimal audit entry', async () => {
    const removed = {
      'organizations/unused': { name: 'Unused test organization' },
      'organizations/unused/members/owner': { uid: 'owner', role: 'owner' },
      'organizations/unused/members/editor': { uid: 'editor', role: 'editor' },
      'applications/draft': request('draft', { signupLinkId: 'used' }),
      'applications/withdrawn': request('withdrawn'),
      'applications/declined': request('declined'),
      'invites/pending': { orgId: 'unused', status: 'pending' },
      'invites/accepted': { orgId: 'unused', status: 'accepted' },
      'invites/expired': { orgId: 'unused', status: 'pending', expiresAt: new Date(0) },
      'signup_links/open': { orgId: 'unused', status: 'open' },
      'signup_links/used': { orgId: 'unused', appId: 'draft', status: 'used' },
      'signup_links/by-app': { appId: 'withdrawn', status: 'revoked' },
      'site_names/reserved': { orgId: 'unused', appId: 'draft' },
      'site_names/by-app': { appId: 'withdrawn' },
      'console_connections/draft': { stripe: { accountId: 'acct_test' } },
      'console_connection_states/pending': { orgId: 'unused', appId: 'draft', expiresAt: at },
    };
    const kept = {
      'organizations/other': { name: 'Another organization' },
      'organizations/other/members/owner': { uid: 'owner', role: 'owner' },
      'applications/other': { orgId: 'other', status: 'launched' },
      'console_builds/other': { resources: { projectId: 'real-site' } },
      'signup_links/unrelated': { organizationName: 'Unused test organization', status: 'open' },
      'invites/other': { orgId: 'other', status: 'pending' },
      'console_audit/existing': { action: 'create-signup-link', linkId: 'used', by: 'ops', at },
    };
    await seed({ ...removed, ...kept });
    await expect(deleteOrganization(deps(), input)).resolves.toEqual({ body: { orgId: 'unused', deleted: true } });
    for (const path of Object.keys(removed)) expect((await db.doc(path).get()).exists, path).toBe(false);
    for (const path of Object.keys(kept)) expect((await db.doc(path).get()).exists, path).toBe(true);
    expect((await db.collection('console_token_deletions').get()).empty).toBe(true);
    const audit = (await db.collection('console_audit').where('action', '==', 'delete-organization').get()).docs.map((doc) => doc.data());
    expect(audit).toHaveLength(1);
    expect(Object.keys(audit[0]).sort()).toEqual(['action', 'at', 'by', 'orgId']);
    expect({ ...audit[0], at: audit[0].at.toDate() }).toEqual({ action: 'delete-organization', orgId: 'unused', by: 'ops', at });
  });

  it('keeps token cleanup durable when the provider store is unavailable', async () => {
    secrets.failDelete = true;
    await seed({ 'console_connections/draft': { stripe: { accountId: 'acct_test' } } });
    await deleteOrganization(deps(), input);
    expect((await db.doc('organizations/unused').get()).exists).toBe(false);
    expect((await db.doc('console_token_deletions/draft').get()).data().connected).toEqual([{ provider: 'stripe', accountId: 'acct_test' }]);
  });
});
