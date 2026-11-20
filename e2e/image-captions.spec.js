import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { ADMIN_EMAIL, adminAuth, adminDb, adminIdToken, callFunction, ensureUser } from './helpers.mjs';

const pageId = 'caption-photo-guide';
const section = 'caption-photo-guide-main';
const field = 'station-photo';
const title = 'Station photo guide';
const alt = 'Attendees gathered at the venue';
const caption = 'A view from the gathering';
const credit = 'Event photo team';
const viewports = [{ width: 390, height: 844 }, { width: 1280, height: 900 }];
const pageRef = () => adminDb().doc(`cmsPages/${pageId}`);
const blockRef = () => adminDb().doc(`cmsContent/${section}__${field}`);
let asset;
let idToken;

test.use({ trace: 'off', screenshot: 'off' });

// Captures use synthetic media on the emulator. The regular CI test skips
// the extra viewport passes unless an evidence directory is requested.
async function capture(page, stage, locator) {
  const directory = process.env.CAPTION_EVIDENCE_DIR;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await locator.scrollIntoViewIfNeeded();
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.screenshot({ path: path.join(directory, `${stage}-${viewport.width}.png`), animations: 'disabled' });
  }
}

async function signInForEditing(page) {
  const [token] = await Promise.all([
    ensureUser(ADMIN_EMAIL).then((uid) => adminAuth().createCustomToken(uid)),
    page.goto(`/admin/content/${pageId}/${section}/${field}`, { waitUntil: 'domcontentloaded' })
      .then(() => expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()),
  ]);
  const moduleUrl = `/@fs/${path.resolve('e2e/browser-auth.js').split(path.sep).join('/')}`;
  await page.evaluate(async ({ moduleUrl, token }) => {
    const { signInWithEmulatorToken } = await import(moduleUrl);
    await signInWithEmulatorToken(token);
  }, { moduleUrl, token });
  await page.getByRole('link', { name: 'Go to the admin CMS', exact: true }).click();
}

test.beforeAll(async () => {
  idToken = await adminIdToken();
  const source = await fs.readFile('apps/web/public/demo/summit-gathering.webp');
  // Only the screenshot run needs a desktop-resolution fixture and variants.
  const bytes = process.env.CAPTION_EVIDENCE_DIR ? source : await sharp(source).resize({ width: 320 }).webp().toBuffer();
  const uploaded = await callFunction('mediaUpload', {
    folder: 'cms-images',
    contentType: 'image/webp',
    filename: 'caption-test.webp',
    title: 'Caption test photo',
    alt,
    data: bytes.toString('base64'),
  }, idToken);
  expect(uploaded.status).toBe(200);
  asset = uploaded.body.asset;
  const batch = adminDb().batch();
  batch.set(pageRef(), {
    id: pageId, path: `/${pageId}`, label: title, title, visible: true, systemPage: false,
    order: 999, revision: 1,
    sections: [{ id: section, label: 'Photos', allowedBlocks: ['image'], maxBlocks: 2 }],
  });
  batch.set(blockRef(), { section, field, blockType: 'image', url: asset.path, alt, visible: true, revision: 1 });
  await batch.commit();
});

test.afterAll(async () => {
  if (!asset) return;
  const deleted = await callFunction('cmsDeleteContent', { section, field }, idToken);
  expect(deleted.status).toBe(200);
  await pageRef().delete();
  const removed = await callFunction('mediaDelete', { assetId: asset.id }, idToken);
  expect(removed.status).toBe(200);
  expect((await adminDb().doc(`media_captions/${asset.id}`).get()).exists).toBe(false);
});

async function saveLibraryText() {
  const updated = await callFunction('mediaUpdateMetadata', { assetId: asset.id, caption, credit }, idToken);
  expect(updated.status).toBe(200);
}

test('library text follows an open non-home image and fits inside its overlay', async ({ page }) => {
  await page.goto(`/${pageId}`, { waitUntil: 'domcontentloaded' });
  const image = page.getByRole('img', { name: alt });
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveAttribute('src', /127\.0\.0\.1:9199\/v0\/b\/[^/]+\/o\/cms-images%2F/);
  const loadedImage = expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
  if (process.env.CAPTION_EVIDENCE_DIR) {
    await loadedImage;
    await capture(page, 'public-before', image);
  }
  await Promise.all([loadedImage, saveLibraryText()]);
  const figure = page.getByRole('figure').filter({ has: image });
  await expect(figure.locator('figcaption')).toHaveText(`${caption}Credit: ${credit}`);
  const overlay = figure.getByText(caption, { exact: true });
  const attribution = figure.getByText(`Credit: ${credit}`, { exact: true });
  await expect(overlay).toHaveAttribute('lang', 'en');
  await expect(attribution).toHaveAttribute('lang', 'en');
  const [plainArt, belowCaption] = await Promise.all([image.boundingBox(), figure.locator('figcaption').boundingBox()]);
  expect(belowCaption.width).toBeCloseTo(plainArt.width, 0);

  await blockRef().update({ captionMode: 'overlay', captionAlign: 'center' });
  await expect(figure.locator('figcaption')).toHaveCSS('text-align', 'center');
  await expect(overlay).toHaveCSS('color', 'rgb(255, 255, 255)');
  const [art, bar, creditBox] = await Promise.all([
    image.boundingBox(), overlay.boundingBox(), attribution.boundingBox(),
  ]);
  expect(bar.x).toBeCloseTo(art.x, 0);
  expect(bar.width).toBeCloseTo(art.width, 0);
  expect(bar.y).toBeGreaterThanOrEqual(art.y);
  expect(bar.y + bar.height).toBeCloseTo(art.y + art.height, 0);
  expect(creditBox.y).toBeGreaterThanOrEqual(art.y + art.height);
  await capture(page, 'public-after', figure);
});

test('the editor previews and publishes caption settings', async ({ page }) => {
  await Promise.all([
    saveLibraryText(),
    blockRef().update({ captionMode: 'below', captionAlign: 'left' }).then(() => signInForEditing(page)),
  ]);
  await page.getByLabel('Caption display', { exact: true }).selectOption('overlay');
  await page.getByLabel('Caption alignment', { exact: true }).selectOption('center');
  const preview = page.getByRole('region', { name: 'Image preview' });
  await expect(preview.getByText(caption, { exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(preview.locator('figcaption')).toHaveCSS('text-align', 'center');
  await capture(page, 'editor-after', preview);

  const published = page.waitForResponse((response) =>
    response.url().endsWith('/cmsPublish') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save and publish', exact: true }).click();
  expect((await published).ok()).toBe(true);
  expect((await blockRef().get()).data()).toMatchObject({ captionMode: 'overlay', captionAlign: 'center' });
});

test('hover captions reveal on keyboard focus and stay visible on touch', async ({ browser, page }) => {
  await saveLibraryText();
  await blockRef().update({ captionMode: 'hover' });
  await page.goto(`/${pageId}`, { waitUntil: 'domcontentloaded' });
  const figure = page.getByRole('figure').filter({ has: page.getByRole('img', { name: alt }) });
  const text = figure.getByText(caption, { exact: true });
  await expect(text).toHaveCSS('opacity', '0');
  await figure.focus();
  await expect(text).toHaveCSS('opacity', '1');
  await page.keyboard.press('Tab');
  await expect(text).toHaveCSS('opacity', '0');
  await page.keyboard.press('Shift+Tab');
  await expect(figure).toBeFocused();
  await expect(text).toHaveCSS('opacity', '1');
  await page.keyboard.press('Tab');
  await figure.hover();
  await expect(text).toHaveCSS('opacity', '1');

  const touch = await browser.newContext({ hasTouch: true, isMobile: true, viewport: viewports[0] });
  try {
    const phone = await touch.newPage();
    await phone.goto(`/${pageId}`, { waitUntil: 'domcontentloaded' });
    await expect(phone.getByText(caption, { exact: true })).toHaveCSS('opacity', '1');
  } finally {
    await touch.close();
  }
});
