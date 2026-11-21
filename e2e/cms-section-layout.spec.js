// Section layout (issue #1153): an organizer picks a layout for one section
// by picture in the page editor, publishes, and the public page draws it.
// Two columns stay one column on a phone.
/* global getComputedStyle */
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, signIn } from './helpers.mjs';
import { expectPageFits, expectTextFits, setReflowProfile } from './reflow.mjs';
import { RETRY_DELAY_MS } from '../apps/web/src/lib/retrySubscription.js';

const CONTENT_TIMEOUT_MS = RETRY_DELAY_MS + 15_000;

async function openVenueLayout(page) {
  await page.goto('/admin/pages/travel');
  const venue = page.getByRole('button', { name: /^Venue \d+ blocks?$/ });
  await expect(venue).toBeVisible({ timeout: CONTENT_TIMEOUT_MS });
  if ((await venue.getAttribute('aria-expanded')) !== 'true') await venue.click();
  return page.getByRole('group', { name: 'Layout' }).first();
}

async function setVenueLayout(page, name) {
  const layout = await openVenueLayout(page);
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

test('section layout choices give their descriptions room at phone widths and enlarged text', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL);
  const layout = await openVenueLayout(page);
  const cards = layout.locator('label');
  await expect(cards).toHaveCount(3);

  for (const profile of [
    { width: 320, stackPicture: false },
    { width: 720, rootSize: 32, stackPicture: false },
    { width: 320, rootSize: 32, stackPicture: true },
  ]) {
    await setReflowProfile(page, profile);
    await expectTextFits(layout);
    const geometry = await cards.evaluateAll((options) => options.map((card) => {
      const { width, height } = card.getBoundingClientRect();
      const picture = card.querySelector('.admin-section-layout__picture').getBoundingClientRect();
      const head = card.querySelector('.admin-section-layout__head').getBoundingClientRect();
      const name = card.querySelector('.admin-section-layout__name').getBoundingClientRect();
      const summary = card.querySelector('.admin-section-layout__summary').getBoundingClientRect();
      return {
        fillsRow: Math.abs(width - card.parentElement.clientWidth) <= 1,
        fits: card.scrollWidth - card.clientWidth <= 1,
        largeEnough: width >= 44 && height >= 44,
        summaryBelowName: summary.top >= name.bottom - 1,
        pictureAboveText: picture.bottom <= head.top + 1 && Math.abs(picture.left - summary.left) <= 1,
      };
    }));
    expect(geometry).toEqual(Array.from({ length: 3 }, () => ({
      fillsRow: true, fits: true, largeEnough: true, summaryBelowName: true, pictureAboveText: profile.stackPicture,
    })));
    await expectPageFits(page);
  }

  const wide = layout.getByRole('radio', { name: 'Wide', exact: true });
  await wide.press('Space');
  await expect(wide).toBeChecked();
  await layout.screenshot({ path: 'test-results/admin-visual-evidence/section-layout-320-large-text.png' });
});

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
