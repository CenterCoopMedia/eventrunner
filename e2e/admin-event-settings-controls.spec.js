// Event settings lists and time zone (issue #475), in a real browser against
// the emulators: the time zone chosen from the keyboard, compact add and
// remove controls named for their own item, and a layout that holds with
// many items and long labels at desktop, 390px, 320px, and the width 200%
// zoom gives a 1280px window. Nothing is saved. Captures go to
// EVENT_SETTINGS_EVIDENCE_DIR when set.
/* global document, getComputedStyle, window */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';

const EVIDENCE = process.env.EVENT_SETTINGS_EVIDENCE_DIR;
const LONG = 'A very long label that keeps going well past the width of a narrow phone screen';
const VIEWPORTS = [
  ['desktop', { width: 1280, height: 900 }],
  ['zoom-200', { width: 640, height: 450 }],
  ['phone', { width: 390, height: 844 }],
  ['narrow', { width: 320, height: 640 }],
];

async function endTour(page) {
  const button = page.getByRole('button', { name: 'End tour', exact: true });
  if (await button.isVisible()) await button.click();
}

test('event days, tracks, and the time zone use labelled compact controls that fit every width', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('pageerror', (err) => console.error('Browser error:', err.message));
  const before = (await adminDb().doc('config/event').get()).data();
  await signIn(page, ADMIN_EMAIL);
  await page.setViewportSize(VIEWPORTS[0][1]);
  await page.goto('/admin/settings');
  await expect(page.getByLabel('Event name', { exact: true })).toHaveValue(before.name);
  await endTour(page);

  // The time zone: no raw IANA text box, and a keyboard path through the list.
  await expect(page.getByLabel('Timezone', { exact: true })).toHaveCount(0);
  const zone = page.getByRole('combobox', { name: 'Time zone' });
  await expect(zone).toHaveValue(/^New York \(Eastern Time, UTC−0[45]:00\)$/);
  await zone.focus();
  await expect(zone).toBeFocused();
  expect(await zone.evaluate((element) => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none'),
    'the field shows its focus ring').toBe(true);
  await page.keyboard.type('tokyo');
  const list = page.getByRole('listbox', { name: 'Time zone' });
  await expect(list).toBeVisible();
  await expect(zone).toHaveAttribute('aria-expanded', 'true');
  await expect(list.getByRole('option').first()).toContainText('Tokyo');
  await page.keyboard.press('Enter');
  await expect(zone).toHaveValue('Tokyo (Japan Standard Time, UTC+09:00)');
  await expect(page.getByText(/Saved as Asia\/Tokyo\./)).toBeVisible();
  await expect(zone).toHaveAttribute('aria-expanded', 'false');
  // Escape puts the zone back while searching.
  await page.keyboard.type('paris');
  await page.keyboard.press('Escape');
  await expect(zone).toHaveValue('Tokyo (Japan Standard Time, UTC+09:00)');

  // The days: no id field, one add control, and a remove control per day
  // that names that day.
  await expect(page.getByLabel(/^Day \d+ id$/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add day', exact: true })).toHaveCount(1);
  // Add and remove wait for the live and draft session lists.
  await expect(page.getByRole('button', { name: 'Add day', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  const dayCount = await page.getByRole('button', { name: /^Remove day \d+/ }).count();
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: 'Add day', exact: true }).click();
    const n = dayCount + i + 1;
    await expect(page.getByLabel(`Day ${n} label`, { exact: true })).toBeFocused();
    await page.keyboard.type(`${LONG} ${n}`);
  }
  await expect(page.getByRole('button', { name: `Remove day ${dayCount + 4}, ${LONG} ${dayCount + 4}`, exact: true })).toBeVisible();

  // The tracks: many of them, with long names, added from the keyboard.
  const trackCount = await page.getByRole('button', { name: /^Remove track \d+/ }).count();
  for (let i = 0; i < 6; i += 1) {
    await page.getByRole('button', { name: 'Add track', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(`Track ${trackCount + i + 1} name`, { exact: true })).toBeFocused();
    await page.keyboard.type(`${LONG} track`);
  }

  // Removing an added, unused day happens at once and says it waits for save.
  const lastDay = dayCount + 4;
  await page.getByRole('button', { name: `Remove day ${lastDay}, ${LONG} ${lastDay}`, exact: true }).click();
  await expect(page.getByText(`${LONG} ${lastDay} will be removed when you save.`)).toBeVisible();
  await expect(page.getByRole('button', { name: `Remove day ${lastDay - 1}, ${LONG} ${lastDay - 1}`, exact: true })).toBeFocused();

  for (const [name, viewport] of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    // Open the list at this width too.
    await zone.focus();
    await page.keyboard.press('ArrowDown');
    await expect(list).toBeVisible();
    const geometry = await page.evaluate(() => {
      const inside = (element, boundary) => {
        const box = element.getBoundingClientRect();
        const edge = boundary.getBoundingClientRect();
        return box.left >= edge.left - 1 && box.right <= edge.right + 1;
      };
      const essentials = document.querySelector('.admin-settings-grid--essentials');
      const controls = [...essentials.querySelectorAll('input, button, [role="listbox"]')].filter((element) => element.getClientRects().length > 0);
      const buttons = [...essentials.querySelectorAll('button')].filter((element) => element.getClientRects().length > 0);
      return {
        pageFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
        controlsInCards: controls.every((element) => inside(element, element.closest('.admin-settings-row-card, .admin-panel'))),
        cardsFit: [...essentials.querySelectorAll('.admin-panel, .admin-settings-row-card')].every((card) => card.scrollWidth <= card.clientWidth + 1),
        // Compact never means smaller: every add and remove control keeps one height.
        buttonHeights: [...new Set(buttons.map((element) => Math.round(element.getBoundingClientRect().height)))],
        minButtonHeight: Math.min(...buttons.map((element) => element.getBoundingClientRect().height)),
      };
    });
    expect(geometry.pageFits, `no sideways scroll at ${name}`).toBe(true);
    expect(geometry.controlsInCards, `controls stay in their cards at ${name}`).toBe(true);
    expect(geometry.cardsFit, `cards hold their content at ${name}`).toBe(true);
    expect(geometry.minButtonHeight, `buttons keep a full target at ${name}`).toBeGreaterThanOrEqual(24);
    expect(geometry.buttonHeights.length, `buttons share one height at ${name}`).toBe(1);
    if (EVIDENCE) {
      await fs.mkdir(EVIDENCE, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.admin-settings-grid--essentials').first().screenshot({ path: path.join(EVIDENCE, `event-essentials-${name}.png`), animations: 'disabled' });
    }
    await page.keyboard.press('Escape');
  }

  // Nothing was saved.
  expect((await adminDb().doc('config/event').get()).data()).toEqual(before);
});
