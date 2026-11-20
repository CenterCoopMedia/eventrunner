import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

async function upload(token, filename, title, alt) {
  const data = await fs.readFile(path.resolve('apps/web/public/demo/speakers', filename));
  const response = await callFunction('mediaUpload', {
    folder: 'cms-images', filename, title, alt, contentType: 'image/webp', data: data.toString('base64'),
  }, token);
  expect(response.status).toBe(200);
  return response.body.asset;
}

async function capture(page, action, phase) {
  const directory = path.resolve('test-results/admin-visual-evidence');
  await fs.mkdir(directory, { recursive: true });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await action.scrollIntoViewIfNeeded();
    const bounds = await action.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: path.join(directory, `media-replacement-${phase}-${width}.png`), animations: 'disabled' });
  }
}

test('an editor replaces a library image on an event page and keeps its draft settings', async ({ page }) => {
  const db = adminDb();
  const token = await adminIdToken();
  const id = 'media-replacement-proof';
  const pageRef = db.doc(`cmsPages/${id}`);
  const photo = db.doc(`cmsContent/${id}__photo`);
  const draft = db.doc(`cmsContent_drafts/${id}__photo`);
  const assets = [];
  try {
    const original = await upload(token, 'elena-santos.webp', 'Original arrival photo', 'Original arrival view');
    assets.push(original);
    const replacement = await upload(token, 'nora-chen.webp', 'Replacement arrival photo', 'Replacement arrival view');
    assets.push(replacement);
    const metadata = await callFunction('mediaUpdateMetadata', {
      assetId: replacement.id, caption: 'Updated arrival caption', credit: 'Fixture photo credit',
    }, token);
    expect(metadata.status).toBe(200);
    const image = { section: id, field: 'photo', blockType: 'image', url: original.path, alt: 'Original arrival view', caption: 'Old arrival caption', visible: true };
    await Promise.all([
      pageRef.set({ label: 'Arrival guide', title: 'Arrival guide', path: `/${id}`, order: 999, visible: true, systemPage: false,
        sections: [{ id, label: 'Arrivals', description: '', allowedBlocks: ['image'], maxBlocks: 4, reorderable: true, defaultBlocks: [] }] }),
      photo.set({ ...image, revision: 1, focalX: 28, size: 'small', alignment: 'center' }),
      draft.set({ ...image, status: 'dirty', basedOnRevision: 1, focalX: 73, size: 'large', alignment: 'right' }),
    ]);
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/media');
    await page.getByRole('button', { name: /Original arrival photo/ }).click();
    const details = page.getByRole('dialog', { name: 'Original arrival photo' });
    const replace = details.getByRole('button', { name: 'Replace this image' });
    await expect(replace).toBeVisible();
    await capture(page, replace, 'before');

    await replace.click();
    const chooser = page.getByRole('dialog', { name: 'Choose the replacement image' });
    await expect(chooser.getByRole('button', { name: /Original arrival photo/ })).toHaveCount(0);
    await chooser.getByRole('button', { name: /Replacement arrival photo/ }).click();
    await expect(details.getByText('Published · url')).toBeVisible();
    await expect(details.getByText('Draft · url')).toBeVisible();
    const confirm = details.getByRole('button', { name: 'Confirm replacement' });
    await capture(page, confirm, 'after');
    await confirm.click();
    await expect(details.getByText('2 places changed.')).toBeVisible();
    await expect(details.getByRole('button', { name: 'Delete this file', exact: true })).toBeVisible();
    expect((await db.doc(`media_assets/${original.id}`).get()).exists).toBe(true);
    const live = (await photo.get()).data();
    expect(live).toMatchObject({ url: replacement.path, focalX: 28, alt: 'Replacement arrival view', size: 'small', alignment: 'center' });
    expect(live).not.toHaveProperty('caption');
    expect((await draft.get()).data()).toMatchObject({ url: replacement.path, focalX: 73, status: 'dirty', size: 'large', alignment: 'right' });

    await page.goto(`/${id}`);
    const imageAfter = page.getByRole('img', { name: 'Replacement arrival view' });
    await expect(imageAfter).toBeVisible();
    await expect(imageAfter).toHaveAttribute('src', new RegExp(encodeURIComponent(replacement.path)));
    await expect(page.getByText('Updated arrival caption', { exact: true })).toBeVisible();
    await expect(page.getByText('Credit: Fixture photo credit', { exact: true })).toBeVisible();
  } finally {
    await Promise.all([pageRef.delete(), photo.delete(), draft.delete()]);
    for (const asset of assets) {
      const result = await callFunction('mediaDelete', { assetId: asset.id }, token);
      expect(result.status).toBe(200);
    }
  }
});
