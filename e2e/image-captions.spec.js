import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { FieldValue } from 'firebase-admin/firestore';
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
let dimensions;
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
  const { width, height } = await sharp(bytes).metadata();
  dimensions = { width, height };
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

async function addPhotoDimensions(page, dimensions) {
  await page.route('**/src/generated/siteContent.js*', async (route) => {
    const response = await route.fetch();
    const snapshot = JSON.stringify({ [asset.path]: dimensions });
    await route.fulfill({ response, body: `${await response.text()}\nObject.assign(imageDimensions, ${snapshot});\n` });
  });
}

async function measurePhoto(image, pending = false) {
  let geometry;
  // The live block and caption chunk can replace the snapshot's image.
  await expect.poll(async () => {
    geometry = await image.evaluateAll(([node], pending) => {
      if (!node) return null;
      if (pending) {
        if (globalThis.getComputedStyle(node).visibility !== 'hidden') return null;
      } else if (!node.complete || node.naturalWidth === 0) {
        node.scrollIntoView({ block: 'nearest' });
        return null;
      }
      const { width, height, x } = node.getBoundingClientRect();
      const column = node.closest('.space-y-lg').getBoundingClientRect();
      return { width, height, offset: x - column.x, columnWidth: column.width };
    }, pending);
    return geometry?.width ?? 0;
  }).toBeGreaterThan(0);
  return geometry;
}

test('a published photo reserves its responsive height before its manifest arrives', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await addPhotoDimensions(page, dimensions);
  const manifestPath = `${path.posix.dirname(asset.path)}/_sizes/manifest.json`;
  const { promise: manifestGate, resolve: releaseManifest } = Promise.withResolvers();
  await page.route((url) => decodeURIComponent(url.pathname).endsWith(`/o/${manifestPath}`), async (route) => {
    await manifestGate;
    await route.continue();
  });
  const image = page.locator(`img[alt="${alt}"]`);
  let reserved;
  try {
    await page.goto(`/${pageId}`, { waitUntil: 'domcontentloaded' });
    reserved = await measurePhoto(image, true);
    expect(reserved.width).toBeLessThan(dimensions.width);
    expect(reserved.height).toBeCloseTo(reserved.width * dimensions.height / dimensions.width, 0);
  } finally {
    releaseManifest();
  }
  expect((await measurePhoto(image)).height).toBeCloseTo(reserved.height, 0);
});

test('published dimensions preserve the responsive column width and the chosen photo sizes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const width = 600;
  const height = 450;
  const sizesDir = `${path.posix.dirname(asset.path)}/_sizes`;
  const copyPath = `${sizesDir}/1/320.webp`;
  const routeObject = (object, handler) => page.route(
    (url) => decodeURIComponent(url.pathname).endsWith(`/o/${object}`), handler,
  );
  // Serve exact source dimensions independently of the asynchronous Storage trigger.
  for (const [object, imageWidth, imageHeight] of [[asset.path, width, height], [copyPath, 320, 240]]) {
    const body = await sharp({
      create: { width: imageWidth, height: imageHeight, channels: 3, background: { r: 119, g: 119, b: 119 } },
    }).webp().toBuffer();
    await routeObject(object, (route) => route.fulfill({ contentType: 'image/webp', body }));
  }
  let manifestGate;
  await routeObject(`${sizesDir}/manifest.json`, async (route) => {
    await manifestGate;
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {
        status: 'ready', source: asset.path, sourceGeneration: '1', width, height,
        sizes: [{ target: 320, width: 320, path: copyPath }],
      },
    });
  });
  const image = page.locator(`img[alt="${alt}"]`);
  await page.goto(`/${pageId}`, { waitUntil: 'domcontentloaded' });
  await expect(image).toHaveAttribute('sizes', '100vw');
  await expect(image).not.toHaveAttribute('width');
  const before = await measurePhoto(image);
  expect(before.columnWidth).toBeGreaterThan(width);
  expect(before.width).toBeCloseTo(before.columnWidth, 0);

  const { promise, resolve: releaseManifest } = Promise.withResolvers();
  manifestGate = promise;
  let reserved;
  try {
    await addPhotoDimensions(page, { width, height });
    await page.reload({ waitUntil: 'domcontentloaded' });
    reserved = await measurePhoto(image, true);
    expect(reserved.width).toBeCloseTo(before.width, 0);
    expect(reserved.height).toBeCloseTo(before.width * height / width, 0);
  } finally {
    releaseManifest();
  }
  const loaded = await measurePhoto(image);
  expect(loaded.width).toBeCloseTo(reserved.width, 0);
  expect(loaded.height).toBeCloseTo(reserved.height, 0);

  // Widen the real content column so the Large and Full caps differ.
  await page.setViewportSize({ width: 2200, height: 900 });
  await page.addStyleTag({ content: 'main.stage { --stage-max: 2200px; }' });
  try {
    for (const [size, cap, alignment, offset] of [
      ['small', 320, 'left', 0], ['medium', 640, 'center', 0.5],
      ['large', 1280, 'right', 1], ['full', 1920, 'center', 0.5],
    ]) {
      await blockRef().update({ size, alignment });
      await expect(image).toHaveAttribute('sizes', `(max-width: ${cap}px) 100vw, ${cap}px`);
      const photo = await measurePhoto(image);
      expect(photo.columnWidth).toBeGreaterThan(cap);
      expect(photo.width).toBeCloseTo(cap, 0);
      expect(photo.offset).toBeCloseTo((photo.columnWidth - cap) * offset, 0);
    }
  } finally {
    await blockRef().update({ size: FieldValue.delete(), alignment: FieldValue.delete() });
  }
});

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
