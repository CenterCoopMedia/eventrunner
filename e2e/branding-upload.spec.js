import { test, expect } from '@playwright/test';
import path from 'node:path';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, FUNCTIONS_ORIGIN, signIn } from './helpers.mjs';

test('the Branding picker uploads once without navigating or publishing the theme', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/branding');
  await page.getByRole('button', { name: 'Identity', exact: true }).click();
  const primary = page.getByRole('textbox', { name: 'Primary logo' });
  const savedTheme = (await adminDb().doc('config/theme').get()).data();
  await primary.locator('..').getByRole('button', { name: 'Choose or upload…' }).click();
  await page.getByRole('dialog', { name: 'Choose an image', exact: true })
    .getByRole('button', { name: 'Upload a file', exact: true }).first().click();
  const upload = page.getByRole('dialog', { name: 'Upload a file', exact: true });
  await upload.getByLabel('File', { exact: true }).setInputFiles(path.resolve('apps/web/public/branding/nclocal-logo.png'));
  await upload.getByRole('textbox', { name: 'Image description', exact: true }).fill('NC Local');
  await upload.getByRole('textbox', { name: 'Title (optional)', exact: true }).fill('NC Local logo');

  const brandingUrl = page.url();
  const uploads = [];
  const publishes = [];
  const navigations = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (request.url() === `${FUNCTIONS_ORIGIN}/mediaUpload`) uploads.push(request);
    if (request.url() === `${FUNCTIONS_ORIGIN}/updateTheme`) publishes.push(request);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  let asset;
  try {
    const responsePromise = page.waitForResponse((response) =>
      response.url() === `${FUNCTIONS_ORIGIN}/mediaUpload` && response.request().method() === 'POST');
    await upload.getByRole('button', { name: 'Upload', exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    ({ asset } = await response.json());
    expect(asset.path).toMatch(/^branding\/[^/]+\/nclocal-logo\.png$/);
    await expect(primary).toHaveValue(asset.path);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(brandingUrl);
    expect(navigations).toEqual([]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].postDataJSON()).toMatchObject({ folder: 'branding', alt: 'NC Local', title: 'NC Local logo' });
    expect(publishes).toEqual([]);
    expect((await adminDb().doc('config/theme').get()).data()).toEqual(savedTheme);
  } finally {
    if (asset) {
      const deleted = await callFunction('mediaDelete', { assetId: asset.id }, await adminIdToken());
      expect(deleted.status).toBe(200);
    }
  }
});
