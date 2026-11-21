// Section layout (issue #1153): an organizer picks a layout for one section
// by picture in the page editor, publishes, and the public page draws it.
// Two columns stay one column on a phone.
/* global getComputedStyle */
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, signIn } from './helpers.mjs';
import { RETRY_DELAY_MS } from '../apps/web/src/lib/retrySubscription.js';

const CONTENT_TIMEOUT_MS = RETRY_DELAY_MS + 15_000;

async function setVenueLayout(page, name) {
  await page.goto('/admin/pages/travel');
  const venue = page.getByRole('button', { name: /^Venue \d+ blocks?$/ });
  await expect(venue).toBeVisible({ timeout: CONTENT_TIMEOUT_MS });
  if ((await venue.getAttribute('aria-expanded')) !== 'true') await venue.click();
  const layout = page.getByRole('group', { name: 'Layout' }).first();
  await layout.getByRole('radio', { name }).check();
  // The preview beside the choice draws the section's own blocks, each
  // picture in its own document at its true width.
  const preview = page.getByRole('group', { name: 'Preview of Venue' });
  await expect(preview.frameLocator('iframe[title="On a computer"]').locator('body')).toContainText('Example Hall');
  await expect(preview.frameLocator('iframe[title="On a phone"]').locator('body')).toContainText('Example Hall');
  await page.getByRole('button', { name: 'Save and publish' }).click();
  await expect(page.getByText('Published. The public site picks it up live.')).toBeVisible({ timeout: 30_000 });
}

function venueColumns(page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Venue', exact: true }) })
    .locator('.section-blocks--columns');
}

test.describe.serial('section layout chosen in the page editor', () => {
  test('two columns publish to the public page, and fold to one on a phone', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, ADMIN_EMAIL);
    await setVenueLayout(page, 'Two columns');

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/travel');
    const grid = venueColumns(page);
    await expect(grid).toBeVisible({ timeout: CONTENT_TIMEOUT_MS });
    await expect(grid.locator(':scope > *')).toHaveCount(2);
    const desktopTracks = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(desktopTracks).toBe(2);

    await page.setViewportSize({ width: 390, height: 900 });
    const phoneTracks = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(phoneTracks).toBe(1);
  });

  test('reading width restores the single narrow column', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, ADMIN_EMAIL);
    await setVenueLayout(page, 'Reading width');
    await page.goto('/travel');
    await expect(page.getByRole('heading', { name: 'Venue', exact: true })).toBeVisible({ timeout: CONTENT_TIMEOUT_MS });
    await expect(venueColumns(page)).toHaveCount(0);
  });
});
