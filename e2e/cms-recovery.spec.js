import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import seed from '../scripts/lib/seed.cjs';
import store from '../functions/src/cms/store.cjs';
import { ADMIN_EMAIL, adminAuth, adminDb, ensureUser } from './helpers.mjs';

test.use({ trace: 'off', screenshot: 'off' });

async function signInToHistory(page, uid) {
  await page.goto('/admin/versions?collection=cmsPages');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const moduleUrl = `/@fs/${resolve('e2e/browser-auth.js').replaceAll('\\', '/')}`;
  await page.evaluate(async ({ moduleUrl, token }) => {
    const { signInWithEmulatorToken } = await import(moduleUrl);
    await signInWithEmulatorToken(token);
  }, { moduleUrl, token: await adminAuth().createCustomToken(uid) });
  await page.getByRole('link', { name: 'Go to the admin CMS' }).click();
}

test.describe.serial('removed page recovery', () => {
  let context;
  let page;
  let id;
  let title;
  let live;

  test.afterAll(async () => {
    try {
      if (id) {
        const db = adminDb();
        await store.deleteBoth({ db, collection: 'cmsPages', docId: id });
        const versions = await db.collection('cmsVersionHistory').where('docPath', '==', `cmsPages/${id}`).get();
        for (const version of versions.docs) await version.ref.delete();
      }
    } finally {
      await context?.close();
    }
  });

  test('finds a removed published page without a record URL or delete log', async ({ browser }, testInfo) => {
    context = await browser.newContext();
    page = await context.newPage();
    const actor = { uid: await ensureUser(ADMIN_EMAIL), email: ADMIN_EMAIL };
    const db = adminDb();
    id = `a-recovery-${Date.now()}`;
    title = `Recovery page ${id}`;
    const base = seed.defaultPages().find((item) => !item.systemPage);
    live = await test.step('Publish and delete the page fixture', async () => {
      const fields = { ...base, id, path: `/${id}`, title, label: title, sections: [] };
      await store.writeDraft({ db, collection: 'cmsPages', docId: id, fields, actor });
      await store.publishDocs({ db, collection: 'cmsPages', docIds: [id], actor });
      const published = (await db.doc(`cmsPages/${id}`).get()).data();
      expect(published.revision).toBeGreaterThan(0);
      await store.deleteBoth({ db, collection: 'cmsPages', docId: id });
      expect((await db.doc(`cmsPages/${id}`).get()).exists).toBe(false);
      expect((await db.collection('admin_logs').where('docPath', '==', `cmsPages/${id}`).get()).empty).toBe(true);
      return published;
    });
    await test.step('Sign in to the admin', () => signInToHistory(page, actor.uid));
    await page.getByRole('searchbox', { name: 'Search by name' }).fill(title);
    const removed = page.getByRole('region', { name: 'Removed records' });
    await expect(removed.getByRole('link', { name: title })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('removed-records-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(removed.getByRole('link', { name: title })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('removed-records-phone.png'), fullPage: true });
    await removed.getByRole('link', { name: title }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  });

  test('restores the removed page as a draft and removes it from the removed group', async () => {
    await page.getByRole('button', { name: `Restore version ${live.revision}` }).click();
    await page.getByRole('region', { name: `Restore version ${live.revision}?` }).getByRole('button', { name: 'Restore as draft' }).click();
    await expect(page.getByText(`Version ${live.revision} is now the draft. Nothing is on the site until you publish.`)).toBeVisible();
    expect((await adminDb().doc(`cmsPages/${id}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`cmsPages_drafts/${id}`).get()).data().title).toBe(title);
    await page.getByRole('link', { name: 'Back to the list' }).click();
    await page.getByRole('searchbox', { name: 'Search by name' }).fill(title);
    await expect(page.getByRole('region', { name: 'Records' }).getByRole('link', { name: title })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Removed records' }).getByRole('link', { name: title })).toHaveCount(0);
  });
});

test('staff can discover a removed record through the existing history read permission', async ({ page }) => {
  const db = adminDb();
  const email = 'e2e-recovery-staff@example.test';
  const uid = await ensureUser(email);
  const bootstrap = db.doc('config/bootstrap');
  const original = (await bootstrap.get()).data().staffEmails ?? [];
  const record = db.doc('cmsVersionHistory/recovery-staff');
  try {
    await bootstrap.update({ staffEmails: [...original, email] });
    await record.set({ docPath: 'cmsPages/a-recovery-staff', revision: 1, fields: { title: 'Removed staff page' }, visible: true, publishedAt: new Date() });
    await signInToHistory(page, uid);
    await expect(page.locator('[data-admin-tier="staff"]')).toHaveText('Staff');
    await expect(page.getByRole('region', { name: 'Removed records' }).getByRole('link', { name: 'Removed staff page' })).toBeVisible();
  } finally {
    await record.delete();
    await bootstrap.update({ staffEmails: original });
  }
});

test('an account without an admin grant cannot open the removed group', async ({ page }) => {
  const uid = await ensureUser('e2e-recovery-visitor@example.test');
  const profile = adminDb().doc(`users/${uid}`);
  try {
    await profile.set({ displayName: 'Recovery visitor', profileVisibility: 'private', role: 'pending' });
    await signInToHistory(page, uid);
    await expect(page.getByRole('heading', { name: 'You don’t have admin access' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Removed records' })).toHaveCount(0);
  } finally {
    await profile.delete();
  }
});
