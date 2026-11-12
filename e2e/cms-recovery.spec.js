import { test, expect } from '@playwright/test';
import seed from '../scripts/lib/seed.cjs';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

test.use({ trace: 'off', screenshot: 'off' });

test('a removed published page is found without a record URL or delete log and restored as a draft', async ({ page }, testInfo) => {
  const token = await adminIdToken();
  const id = `recovery-${Date.now()}`;
  const title = `Recovery page ${id}`;
  const base = seed.defaultPages().find((item) => !item.systemPage);
  try {
    const saved = await callFunction('cmsSavePage', { page: { ...base, id, path: `/${id}`, title, label: title, sections: [] } }, token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await callFunction('cmsPublish', { collection: 'cmsPages', docIds: [id] }, token)).status).toBe(200);
    const live = (await adminDb().doc(`cmsPages/${id}`).get()).data();
    expect((await callFunction('cmsDeletePage', { id }, token)).status).toBe(200);
    const logs = await adminDb().collection('admin_logs').where('docPath', '==', `cmsPages/${id}`).get();
    for (const log of logs.docs) await log.ref.delete();

    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/versions?collection=cmsPages');
    await page.getByRole('searchbox', { name: 'Search by name' }).fill(title);
    const removed = page.getByRole('region', { name: 'Removed records' });
    await expect(removed.getByRole('link', { name: title })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('removed-records-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(removed.getByRole('link', { name: title })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('removed-records-phone.png'), fullPage: true });
    await removed.getByRole('link', { name: title }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.getByRole('button', { name: `Restore version ${live.revision}` }).click();
    await page.getByRole('region', { name: `Restore version ${live.revision}?` }).getByRole('button', { name: 'Restore as draft' }).click();
    await expect(page.getByText(`Version ${live.revision} is now the draft. Nothing is on the site until you publish.`)).toBeVisible();
    expect((await adminDb().doc(`cmsPages/${id}`).get()).exists).toBe(false);
    expect((await adminDb().doc(`cmsPages_drafts/${id}`).get()).data().title).toBe(title);
    await page.getByRole('link', { name: 'Back to the list' }).click();
    await page.getByRole('searchbox', { name: 'Search by name' }).fill(title);
    await expect(page.getByRole('region', { name: 'Records' }).getByRole('link', { name: title })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Removed records' }).getByRole('link', { name: title })).toHaveCount(0);
  } finally {
    await callFunction('cmsDeletePage', { id }, token);
    const versions = await adminDb().collection('cmsVersionHistory').where('docPath', '==', `cmsPages/${id}`).get();
    for (const version of versions.docs) await version.ref.delete();
  }
});
