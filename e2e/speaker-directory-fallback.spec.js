// Issue #449. A hosted speaker with no headshot must not reserve the
// portrait frame. jsdom does not apply the frame's aspect ratio, so this
// check uses a real 400px viewport.
import { test, expect } from '@playwright/test';
import { adminDb } from './helpers.mjs';

test.describe('speaker directory fallback', () => {
  const stamp = Date.now();
  const missingId = `e2e-no-headshot-${stamp}`;
  const presentId = `e2e-with-headshot-${stamp}`;

  test.beforeAll(async () => {
    const db = adminDb();
    await db.collection('speakers_public').doc(missingId).set({
      displayName: `No Photo ${stamp}`,
      slug: missingId,
      jobTitle: 'Reporter',
      organization: 'NC Local',
      bio: '',
      headshotPath: null,
      firstName: 'No',
      lastName: 'Photo',
      socialHandles: {},
    });
    await db.collection('speakers_public').doc(presentId).set({
      displayName: `With Photo ${stamp}`,
      slug: presentId,
      jobTitle: 'Editor',
      organization: 'NC Local',
      bio: '',
      headshotPath: 'speakers/with.jpg',
      firstName: 'With',
      lastName: 'Photo',
      socialHandles: {},
    });
  });

  test.afterAll(async () => {
    const db = adminDb();
    await db.collection('speakers_public').doc(missingId).delete();
    await db.collection('speakers_public').doc(presentId).delete();
  });

  test('a missing headshot stays compact at 400 CSS px', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 });
    await page.goto('/speakers');
    const missing = page.getByRole('listitem').filter({ hasText: `No Photo ${stamp}` });
    const present = page.getByRole('listitem').filter({ hasText: `With Photo ${stamp}` });
    await expect(missing).toBeVisible();
    await expect(present).toBeVisible();
    await expect(missing.locator('.portrait-shelf__frame')).toHaveCount(0);
    await expect(present.locator('.portrait-shelf__frame')).toHaveCount(1);
    await expect(missing.getByRole('link', { name: `No Photo ${stamp}` })).toBeVisible();
    const box = await missing.boundingBox();
    expect(box.height).toBeLessThan(box.width);
  });
});
