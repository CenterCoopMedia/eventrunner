// Organization representatives (issue #334), on the real surface.
//
// A staff member grants an account representative status from the
// organization editor. The representative signs in through the real
// sign-in page, edits the profile at /profile/organization, and sends it
// for review: the public sponsor page does not change. A direct call that
// names another organization still lands on the representative's own, and
// the staff endpoint refuses the representative. Staff then see the edit
// in the editor, apply it to the draft, and publish; only then does the
// public page show it. Removing the representative ends their access.
// Every grant, edit, apply and revocation leaves its admin_logs row.
//
// config/bootstrap is restored when the file is done.
import { test, expect } from '@playwright/test';
import {
  adminDb, callFunction, ensureUser, idTokenFor, signIn,
} from './helpers.mjs';

const STAFF_EMAIL = 'e2e-orgrep-staff@example.test';
const REP_EMAIL = 'e2e-orgrep-rep@example.test';

test.describe.serial('organization representatives', () => {
  const stamp = Date.now();
  const orgA = `e2e-rep-a-${stamp}`;
  const orgB = `e2e-rep-b-${stamp}`;
  const liveText = `Funds the travel grants (${stamp}).`;
  const newText = `Funds travel and child care (${stamp}).`;
  let seededBootstrap;
  let staff;
  let rep;
  let repUid;
  let repToken;

  async function rowsFor(docPath) {
    const snap = await adminDb().collection('admin_logs').where('docPath', '==', docPath).get();
    return snap.docs.map((doc) => doc.data());
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const db = adminDb();
    const config = db.collection('config');
    seededBootstrap = (await config.doc('bootstrap').get()).data();
    await config.doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
    for (const [id, name, tier, order] of [[orgA, `Rep Org A ${stamp}`, 'presenting', 900], [orgB, `Rep Org B ${stamp}`, 'partner', 901]]) {
      await db.collection('cmsOrganizations').doc(id).set({
        name, tier, order, description: id === orgA ? liveText : 'B stays as it is.',
        url: 'https://example.org/', visible: true, revision: 1, publishedBy: 'e2e',
      });
    }

    staff = await (await browser.newContext()).newPage();
    await signIn(staff, STAFF_EMAIL);
    rep = await (await browser.newContext()).newPage();
    await signIn(rep, REP_EMAIL);
    repUid = await ensureUser(REP_EMAIL);
    repToken = await idTokenFor(repUid);
  });

  test.afterAll(async () => {
    await staff?.context().close();
    await rep?.context().close();
    const db = adminDb();
    if (seededBootstrap) await db.collection('config').doc('bootstrap').set(seededBootstrap);
    for (const id of [orgA, orgB]) {
      await db.collection('cmsOrganizations').doc(id).delete();
      await db.collection('cmsOrganizations_drafts').doc(id).delete();
      await db.collection('organization_edit_requests').doc(id).delete();
    }
    if (repUid) await db.collection('organization_representatives').doc(repUid).delete();
  });

  test('an account that represents nothing is told so', async () => {
    await rep.goto('/profile/organization');
    await expect(rep.getByText('This account does not represent an organization')).toBeVisible();
    await expect(rep.getByRole('button', { name: 'Send for review' })).toHaveCount(0);
  });

  test('staff add a representative from the organization editor, with an audit row', async () => {
    await staff.goto(`/admin/organizations/${orgA}`);
    const reps = staff.getByRole('region', { name: 'Representatives' });
    await expect(reps.getByText('No representatives yet.')).toBeVisible();
    await reps.getByLabel('Account address').fill(REP_EMAIL);
    await reps.getByRole('button', { name: 'Add representative' }).click();
    await expect(reps.getByText('Representative added. They edit at /profile/organization.')).toBeVisible();
    await expect(reps.getByText(REP_EMAIL, { exact: true })).toBeVisible();
    await reps.screenshot({ path: test.info().outputPath('staff-representatives-panel.png') });

    const grant = (await adminDb().collection('organization_representatives').doc(repUid).get()).data();
    expect(grant).toMatchObject({ uid: repUid, email: REP_EMAIL, organizationId: orgA, grantedBy: STAFF_EMAIL });
    expect(await rowsFor(`organization_representatives/${repUid}`)).toEqual([
      expect.objectContaining({ action: 'grantOrganizationRepresentative', email: STAFF_EMAIL, details: { organizationId: orgA } }),
    ]);
  });

  test('the representative edits by keyboard and sends for review; the public page does not change', async ({ browser }, testInfo) => {
    await rep.goto('/profile/organization');
    await expect(rep.getByRole('heading', { level: 1, name: `Rep Org A ${stamp}` })).toBeVisible();
    const description = rep.getByLabel('Short description');
    await expect(description).toHaveValue(liveText);
    await expect(rep.getByLabel(/tier/i)).toHaveCount(0);

    await description.focus();
    await rep.keyboard.press('ControlOrMeta+A');
    await rep.keyboard.type(newText);
    await rep.getByRole('button', { name: 'Send for review' }).focus();
    await rep.keyboard.press('Enter');
    await expect(rep.getByRole('status').filter({ hasText: 'Your changes are waiting for review.' })).toBeVisible();
    // Visual evidence for the review, desktop and narrow (issue #334).
    await rep.screenshot({ path: testInfo.outputPath('representative-page-desktop.png'), fullPage: true });
    await rep.setViewportSize({ width: 390, height: 844 });
    await rep.screenshot({ path: testInfo.outputPath('representative-page-narrow.png'), fullPage: true });
    await rep.setViewportSize({ width: 1280, height: 720 });

    const request = (await adminDb().collection('organization_edit_requests').doc(orgA).get()).data();
    expect(request.fields).toEqual({ description: newText });
    expect(request.submittedByUid).toBe(repUid);
    expect((await adminDb().collection('cmsOrganizations').doc(orgA).get()).data().description).toBe(liveText);
    expect((await adminDb().collection('cmsOrganizations_drafts').doc(orgA).get()).exists).toBe(false);

    const visitor = await browser.newContext();
    try {
      const page = await visitor.newPage();
      await page.goto(`/sponsors/${orgA}`);
      await expect(page.getByText(liveText)).toBeVisible();
      await expect(page.getByText(newText)).toHaveCount(0);
    } finally {
      await visitor.close();
    }
  });

  test('a representative of A cannot reach B, a staff field, or the staff endpoint', async () => {
    const crossed = await callFunction('ownOrganizationProfile', {
      action: 'submit', organizationId: orgB, fields: { description: 'Written by A.' },
    }, repToken);
    expect(crossed.status).toBe(200);
    expect(crossed.body.organizationId).toBe(orgA);
    expect((await adminDb().collection('organization_edit_requests').doc(orgB).get()).exists).toBe(false);
    expect((await adminDb().collection('cmsOrganizations').doc(orgB).get()).data().description).toBe('B stays as it is.');
    // Put the edit back the way the page sent it.
    await callFunction('ownOrganizationProfile', { action: 'submit', fields: { description: newText } }, repToken);

    const tier = await callFunction('ownOrganizationProfile', { action: 'submit', fields: { tier: 'platinum' } }, repToken);
    expect(tier.status).toBe(400);
    expect(tier.body.error.message).toBe('tier: representatives cannot change this field');

    for (const body of [
      { action: 'apply', organizationId: orgA },
      { action: 'grant', organizationId: orgB, email: REP_EMAIL },
      { action: 'revoke', uid: repUid },
    ]) {
      const refused = await callFunction('organizationRepresentatives', body, repToken);
      expect(refused.status, JSON.stringify(body)).toBe(403);
    }
    expect((await adminDb().collection('cmsOrganizations_drafts').doc(orgA).get()).exists).toBe(false);
  });

  test('staff apply the edit to the draft and publish it; only then does the public page change', async ({ browser }, testInfo) => {
    await staff.goto('/admin/organizations');
    const row = staff.getByRole('row').filter({ hasText: `Rep Org A ${stamp}` });
    await expect(row.getByText('Edit waiting for review')).toBeVisible();

    await staff.goto(`/admin/organizations/${orgA}`);
    const review = staff.getByRole('region', { name: 'Edit waiting for review' });
    await expect(review.getByText(newText)).toBeVisible();
    await expect(review.getByText(REP_EMAIL, { exact: false })).toBeVisible();
    await review.screenshot({ path: testInfo.outputPath('staff-review-panel.png') });
    await review.getByRole('button', { name: 'Apply to draft' }).click();
    await expect(staff.getByRole('status').filter({ hasText: 'Edit applied to the draft. Publish to show it on the site.' })).toBeVisible();
    await expect(staff.getByLabel('Description')).toHaveValue(newText);

    const draft = (await adminDb().collection('cmsOrganizations_drafts').doc(orgA).get()).data();
    expect(draft.description).toBe(newText);
    expect(draft.status).toBe('dirty');
    expect(JSON.stringify(draft)).not.toContain(REP_EMAIL);
    expect((await adminDb().collection('cmsOrganizations').doc(orgA).get()).data().description).toBe(liveText);
    expect(await rowsFor(`cmsOrganizations_drafts/${orgA}`)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'applyOrganizationEdit', email: STAFF_EMAIL }),
    ]));

    await staff.getByRole('button', { name: 'Save and publish' }).click();
    await expect(staff.locator('header [data-record-state]')).toHaveText('Live');
    const live = (await adminDb().collection('cmsOrganizations').doc(orgA).get()).data();
    expect(live.description).toBe(newText);
    expect(JSON.stringify(live)).not.toContain(REP_EMAIL);
    expect(JSON.stringify(live)).not.toContain(repUid);

    const visitor = await browser.newContext();
    try {
      const page = await visitor.newPage();
      await page.goto(`/sponsors/${orgA}`);
      await expect(page.getByText(newText)).toBeVisible();
    } finally {
      await visitor.close();
    }
  });

  test('staff remove the representative; the account loses access at once', async () => {
    await staff.goto(`/admin/organizations/${orgA}`);
    const reps = staff.getByRole('region', { name: 'Representatives' });
    await reps.getByRole('button', { name: `Remove ${REP_EMAIL}` }).click();
    await staff.getByRole('region', { name: `Remove ${REP_EMAIL}` }).getByRole('button', { name: 'Remove access' }).click();
    await expect(reps.getByText('No representatives yet.')).toBeVisible();
    expect((await adminDb().collection('organization_representatives').doc(repUid).get()).exists).toBe(false);
    expect(await rowsFor(`organization_representatives/${repUid}`)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'revokeOrganizationRepresentative', email: STAFF_EMAIL }),
    ]));

    await rep.goto('/profile/organization');
    await expect(rep.getByText('This account does not represent an organization')).toBeVisible();
    const refused = await callFunction('ownOrganizationProfile', { action: 'submit', fields: { description: 'Late.' } }, repToken);
    expect(refused.status).toBe(403);
    expect((await adminDb().collection('organization_edit_requests').doc(orgA).get()).exists).toBe(false);
  });
});
