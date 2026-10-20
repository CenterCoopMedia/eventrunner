// Issue #333: display sizes for uploaded images.
//
// The whole path runs on the emulators: an admin uploads a real speaker
// headshot through speakerPhotoUpload, the storage trigger writes the WebP
// sizes and the manifest, and the public speaker list offers them through
// srcset. The browser then loads a size, not the original, at a phone width
// and at a desktop width.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PROJECT_ID, adminDb, adminIdToken, callFunction } from './helpers.mjs';

// A real 1254 x 1254 portrait, about 135 KB: the kind of file a speaker
// sends. The suite runs from the repository root (scripts/dev/run-e2e.sh).
const FIXTURE = path.resolve('apps', 'web', 'public', 'demo', 'speakers', 'elena-santos.webp');
const BUCKET = `${PROJECT_ID}.appspot.com`;
const STORAGE_ORIGIN = 'http://127.0.0.1:9199';

function objectUrl(objectPath) {
  return `${STORAGE_ORIGIN}/v0/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(objectPath)}?alt=media`;
}

async function waitForManifest(manifestPath, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetch(objectUrl(manifestPath));
    if (response.ok) return response.json();
    if (Date.now() > deadline) throw new Error(`no manifest at ${manifestPath} after ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test.describe('image sizes', () => {
  const stamp = Date.now();
  const speakerId = `e2e-sizes-${stamp}`;
  const displayName = `Sized Photo ${stamp}`;
  let headshotPath;
  let originalBytes;

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    const bytes = fs.readFileSync(FIXTURE);
    originalBytes = bytes.length;
    const token = await adminIdToken();
    const upload = await callFunction('speakerPhotoUpload', {
      speakerId,
      contentType: 'image/webp',
      filename: 'portrait.webp',
      data: bytes.toString('base64'),
    }, token);
    expect(upload.status, JSON.stringify(upload.body)).toBe(200);
    headshotPath = upload.body.path;

    const dir = headshotPath.slice(0, headshotPath.lastIndexOf('/'));
    const manifest = await waitForManifest(`${dir}/_sizes/manifest.json`);
    expect(manifest.status).toBe('ready');
    expect(manifest.sizes.map((size) => size.target)).toEqual([320, 640, 1280, 1920]);

    await adminDb().collection('speakers_public').doc(speakerId).set({
      displayName,
      slug: speakerId,
      jobTitle: 'Editor',
      organization: 'NC Local',
      bio: '',
      headshotPath,
      firstName: 'Sized',
      lastName: 'Photo',
      socialHandles: {},
    });
  });

  test.afterAll(async () => {
    await adminDb().collection('speakers_public').doc(speakerId).delete();
  });

  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    test(`a speaker portrait loads a display size at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const imageBytes = new Map();
      page.on('response', async (response) => {
        if (!response.url().startsWith(STORAGE_ORIGIN)) return;
        try {
          imageBytes.set(decodeURIComponent(response.url()), (await response.body()).length);
        } catch {
          // A response the page abandoned has no body to count.
        }
      });

      await page.goto('/speakers');
      const plate = page.getByRole('listitem').filter({ hasText: displayName });
      const img = plate.locator('.portrait-shelf__frame img');
      await img.scrollIntoViewIfNeeded();
      await expect(img).toHaveAttribute('srcset', /_sizes%2F320\.webp\?alt=media 320w/);
      // The slot width the page states for its arrangement (Speakers.jsx).
      await expect(img).toHaveAttribute('sizes', /100vw$/);
      await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);

      const currentSrc = decodeURIComponent(await img.evaluate((el) => el.currentSrc));
      expect(currentSrc).toContain('/_sizes/');
      expect(currentSrc).toMatch(/\/_sizes\/(320|640)\.webp/);
      const loaded = [...imageBytes].find(([url]) => url.includes('/_sizes/'));
      expect(loaded, [...imageBytes.keys()].join('\n')).toBeTruthy();
      // The point of the issue: the list does not download the original.
      expect([...imageBytes.keys()].some((url) => url.includes(headshotPath))).toBe(false);
      expect(loaded[1]).toBeLessThan(originalBytes / 2);
      test.info().annotations.push({
        type: 'bytes',
        description: `${viewport.name}: ${loaded[1]} bytes for ${loaded[0].split('/_sizes/')[1]} against ${originalBytes} for the original`,
      });
    });
  }
});
