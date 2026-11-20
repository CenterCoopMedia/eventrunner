// Gallery block (#1176), on the real path: library uploads, a block created
// and published through the CMS endpoints, and the public page in a browser.
//
// The carousel is driven by keyboard alone: Tab reaches the controls, Enter
// presses Next, and the arrow, Home and End keys step the slides from the
// scroller. The grid case sits on the home page, the slideshow case on a
// content page, so the block is proven outside the home page too.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { adminDb, adminIdToken, callFunction } from './helpers.mjs';

const FIXTURES = ['summit-gathering.webp', 'speakers/amara-okafor.webp', 'speakers/devon-achebe.webp']
  .map((name) => path.resolve('apps', 'web', 'public', 'demo', name));
const ALTS = ['Attendees in the main hall', 'A speaker at the lectern', 'A speaker taking questions'];

async function uploadPictures(token) {
  const images = [];
  for (const [index, file] of FIXTURES.entries()) {
    const upload = await callFunction('mediaUpload', {
      folder: 'cms-images',
      contentType: 'image/webp',
      filename: `gallery-${index}.webp`,
      data: fs.readFileSync(file).toString('base64'),
      alt: ALTS[index],
    }, token);
    expect(upload.status, JSON.stringify(upload.body)).toBe(200);
    images.push({ url: upload.body.asset.path, alt: ALTS[index] });
  }
  return images;
}

async function createAndPublish(token, { pageId, section, field, fields }) {
  const created = await callFunction('cmsCreateContent', {
    collection: 'cmsContent', pageId, section, field, fields, visible: true,
  }, token);
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const published = await callFunction('cmsPublish', { collection: 'cmsContent', docIds: [`${section}__${field}`] }, token);
  expect(published.status, JSON.stringify(published.body)).toBe(200);
}

test.describe.serial('gallery block', () => {
  const stamp = Date.now();
  let token;
  let images;
  const cleanup = [];

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    token = await adminIdToken();
    images = await uploadPictures(token);
  });

  test.afterAll(async () => {
    for (const undo of cleanup.reverse()) await undo();
  });

  test('a carousel on a content page is used by keyboard alone', async ({ page }) => {
    test.setTimeout(90_000);
    const db = adminDb();
    const pageRef = db.doc('cmsPages/travel');
    const original = (await pageRef.get()).data();
    const section = { id: 'travel_gallery', label: 'Photos', description: '', allowedBlocks: [], maxBlocks: 4, reorderable: true, defaultBlocks: [] };
    await pageRef.set({ ...original, sections: [...original.sections, section] });
    cleanup.push(() => pageRef.set(original));
    const field = `carousel-${stamp}`;
    cleanup.push(() => Promise.all([
      db.doc(`cmsContent/travel_gallery__${field}`).delete(),
      db.doc(`cmsContent_drafts/travel_gallery__${field}`).delete(),
    ]));
    await createAndPublish(token, {
      pageId: 'travel',
      section: 'travel_gallery',
      field,
      fields: { blockType: 'gallery', layout: 'carousel', label: 'Venue photos', images },
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/travel');
    const carousel = page.getByRole('region', { name: 'Venue photos' });
    await expect(carousel).toHaveAttribute('aria-roledescription', 'carousel');
    await expect(carousel.locator('[aria-roledescription="slide"]')).toHaveCount(3);
    const position = carousel.locator('[aria-live="polite"]');
    await expect(position).toHaveText('1 of 3');

    const previous = carousel.getByRole('button', { name: 'Previous photo' });
    const next = carousel.getByRole('button', { name: 'Next photo' });
    await expect(previous).toHaveAttribute('aria-disabled', 'true');
    await previous.focus();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(position).toHaveText('2 of 3');
    await expect(next).toBeFocused();
    await expect(previous).not.toHaveAttribute('aria-disabled', 'true');

    await page.keyboard.press('Tab');
    const scroller = carousel.getByRole('group', { name: 'Venue photos, slides' });
    await expect(scroller).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(position).toHaveText('3 of 3');
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Home');
    await expect(position).toHaveText('1 of 3');
    await page.keyboard.press('End');
    await expect(position).toHaveText('3 of 3');
    await page.keyboard.press('ArrowLeft');
    await expect(position).toHaveText('2 of 3');

    // The slide in view is the one the position names.
    const box = await scroller.boundingBox();
    const second = await carousel.locator('[aria-label="2 of 3"]').boundingBox();
    expect(Math.abs(second.x - box.x)).toBeLessThan(2);

    // At 1280 all three fit: the position names the whole run in view.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.keyboard.press('Home');
    await expect(position).toHaveText('1–3 of 3');
    await expect(next).toHaveAttribute('aria-disabled', 'true');
  });

  test('a grid on the home page shows every picture in reserved boxes', async ({ page }) => {
    test.setTimeout(60_000);
    const db = adminDb();
    const field = `grid-${stamp}`;
    cleanup.push(() => Promise.all([
      db.doc(`cmsContent/details__${field}`).delete(),
      db.doc(`cmsContent_drafts/details__${field}`).delete(),
    ]));
    await createAndPublish(token, {
      pageId: 'home',
      section: 'details',
      field,
      fields: { blockType: 'gallery', layout: 'grid', label: 'Last year', images },
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const grid = page.getByRole('region', { name: 'Last year' });
    await grid.scrollIntoViewIfNeeded();
    const pictures = grid.getByRole('img');
    await expect(pictures).toHaveCount(3);
    for (const [index, alt] of ALTS.entries()) await expect(pictures.nth(index)).toHaveAttribute('alt', alt);
    // Each box keeps its 4:3 shape whether or not its picture has loaded.
    for (const cell of await grid.getByRole('listitem').all()) {
      const { width, height } = await cell.boundingBox();
      expect(Math.abs(width / height - 4 / 3)).toBeLessThan(0.02);
    }
  });

  test('a gallery without alt text, or with a picture from outside the library, is refused at save', async () => {
    const refused = await callFunction('cmsCreateContent', {
      collection: 'cmsContent',
      pageId: 'home',
      section: 'details',
      field: `refused-${stamp}`,
      fields: { blockType: 'gallery', layout: 'grid', images: [{ url: images[0].url, alt: '' }, { url: 'https://example.com/a.jpg', alt: 'x' }] },
      visible: true,
    }, token);
    expect(refused.status).toBe(400);
    expect(refused.body?.error?.message).toBe(
      'images.1.alt: every picture needs alt text.; images.2.url: choose the picture from the media library.',
    );
  });
});
