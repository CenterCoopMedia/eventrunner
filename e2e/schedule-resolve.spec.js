import { test, expect } from '@playwright/test';
import { adminDb } from './helpers.mjs';

const RESULTS = '[data-schedule-results]';

async function openSchedule(page, width = 900) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    globalThis.resolves = [];
    const animate = globalThis.Element.prototype.animate;
    globalThis.Element.prototype.animate = function (...args) {
      const animation = Reflect.apply(animate, this, args);
      if (this.hasAttribute('data-schedule-results')) {
        // Keep the browser's actual effect at its first frame. This makes
        // focus and geometry assertions independent of runner speed.
        animation.pause();
        animation.currentTime = 0;
        globalThis.resolves.push({ animation, element: this });
      }
      return animation;
    };
  });
  await page.goto('/');
  await expect(page.locator('article[data-content-source="live"]')).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).locator('a[href="/schedule"]').press('Enter');
  await expect(page.locator(`${RESULTS} a[href^="/schedule/"]`).first()).toBeVisible();
  await page.evaluate(() => globalThis.document.fonts.ready);
  expect(await resolveCount(page)).toBe(0);
}

function resolveCount(page) {
  return page.evaluate(() => globalThis.resolves.length);
}

async function checkResolve(page, count) {
  await expect.poll(() => resolveCount(page)).toBe(count);
  const result = page.locator(RESULTS);
  const first = await result.evaluate((element) => {
    const animation = globalThis.resolves.at(-1).animation;
    const style = globalThis.getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      target: animation.effect.target === element,
      duration: animation.effect.getTiming().duration,
      easing: animation.effect.getTiming().easing,
      token: style.getPropertyValue('--motion-ease').trim(),
      properties: animation.effect.getKeyframes().map((frame) => Object.keys(frame)
        .filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))),
      opacity: style.opacity,
      transform: style.transform,
      bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
    };
  });
  expect(first.target).toBe(true);
  expect(first.duration).toBe(160);
  expect(first.easing).toBe(first.token);
  expect(first.properties).toEqual([['opacity'], ['opacity']]);
  expect(first.opacity).toBe('0.5');
  expect(first.transform).toBe('none');
  const countBounds = await page.locator('.schedule-search [role="status"]').boundingBox();
  expect(await page.locator('.schedule-search [role="status"]').evaluate((element) => ({
    outside: !element.closest('[data-schedule-results]'),
    opacity: globalThis.getComputedStyle(element).opacity,
  }))).toEqual({ outside: true, opacity: '1' });
  const middle = await result.evaluate((element) => {
    globalThis.resolves.at(-1).animation.currentTime = 80;
    return Number(globalThis.getComputedStyle(element).opacity);
  });
  expect(middle).toBeGreaterThan(0.5);
  expect(middle).toBeLessThan(1);
  const end = await result.evaluate((element) => {
    globalThis.resolves.at(-1).animation.finish();
    const bounds = element.getBoundingClientRect();
    const style = globalThis.getComputedStyle(element);
    return { opacity: style.opacity, transform: style.transform,
      bounds: [bounds.x, bounds.y, bounds.width, bounds.height] };
  });
  expect(end).toEqual({ opacity: '1', transform: 'none', bounds: first.bounds });
  expect(await page.locator('.schedule-search [role="status"]').boundingBox()).toEqual(countBounds);
}

test('real filter and sort resolve only the list, preserve focus, nodes and URL history', async ({ page }) => {
  await openSchedule(page);
  const before = await page.locator(`${RESULTS} .session-block`).count();
  const facet = page.getByRole('checkbox', { name: /^panel \(/ });
  await facet.focus();
  await facet.press('Space');
  await expect(facet).toBeChecked();
  await expect(facet).toBeFocused();
  await expect(page).toHaveURL(/format=panel/);
  await expect(page.locator('.schedule-search [role="status"]')).toContainText('selected filters');
  await checkResolve(page, 1);
  const filtered = await page.locator(`${RESULTS} .session-block`).count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(before);
  await page.locator(RESULTS).evaluate((element) => {
    globalThis.filteredList = element;
    globalThis.retainedRow = element.querySelector('.session-block');
  });
  const sort = page.getByLabel('Sort sessions');
  await sort.focus();
  await sort.selectOption('saved');
  await expect(sort).toBeFocused();
  await expect(page).toHaveURL(/sort=saved/);
  await checkResolve(page, 2);
  expect(await page.locator(RESULTS).evaluate((element) =>
    element === globalThis.filteredList && element.contains(globalThis.retainedRow))).toBe(true);
  expect(await page.locator(`${RESULTS} .session-block`).count()).toBe(filtered);
  await page.goBack();
  await expect(sort).toHaveValue('time');
  expect(await resolveCount(page)).toBe(2);
  await page.goForward();
  await expect(sort).toHaveValue('saved');
  expect(await resolveCount(page)).toBe(2);
  const nextDay = page.getByRole('group', { name: 'Event days' }).getByRole('button').nth(1);
  await nextDay.press('Enter');
  await expect(nextDay).toHaveAttribute('aria-pressed', 'true');
  expect(await resolveCount(page)).toBe(2);
  await page.goBack();
  await expect(nextDay).toHaveAttribute('aria-pressed', 'false');
  expect(await resolveCount(page)).toBe(2);
  await page.reload();
  await expect(page.getByLabel('Sort sessions')).toHaveValue('saved');
  await expect(page.getByRole('checkbox', { name: /^panel \(/ })).toBeChecked();
  await expect(page.locator(`${RESULTS} .session-block`).first()).toBeVisible();
  expect(await resolveCount(page)).toBe(0);
});

test('rapid changes cancel the old effect and reduced motion stays instant, including empty search', async ({ page }) => {
  await openSchedule(page);
  const facet = page.getByRole('checkbox', { name: /^panel \(/ });
  await facet.click();
  await expect(facet).toBeChecked();
  await expect.poll(() => resolveCount(page)).toBe(1);
  const interruptedOpacity = await page.locator(RESULTS).evaluate((element) => {
    globalThis.resolves.at(-1).animation.currentTime = 80;
    return Number(globalThis.getComputedStyle(element).opacity);
  });
  await facet.click();
  await expect(facet).not.toBeChecked();
  await expect.poll(() => resolveCount(page)).toBe(2);
  expect(await page.evaluate(() => globalThis.resolves.map(({ animation }) => animation.playState)))
    .toEqual(['idle', 'paused']);
  expect(await page.locator(RESULTS).evaluate((element) => Number(globalThis.getComputedStyle(element).opacity)))
    .toBe(interruptedOpacity);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => globalThis.resolves.at(-1).animation.playState)).toBe('idle');
  expect(await page.locator(RESULTS).evaluate((element) => ({
    opacity: globalThis.getComputedStyle(element).opacity, animations: element.getAnimations().length,
  }))).toEqual({ opacity: '1', animations: 0 });
  const historyLength = await page.evaluate(() => globalThis.history.length);
  const search = page.getByRole('searchbox', { name: 'Search this day' });
  await search.fill('no-matching-session-886');
  await expect(page.locator(RESULTS)).toContainText('No sessions');
  await expect(page.locator('.schedule-search [role="status"]')).toHaveText('0 sessions match “no-matching-session-886”');
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => globalThis.history.length)).toBe(historyLength);
  expect(await resolveCount(page)).toBe(2);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await resolveCount(page)).toBe(2);
  await search.fill('still-no-matching-session-886');
  await checkResolve(page, 3);
  expect(await page.locator(RESULTS).evaluate((element) => element.tagName)).toBe('P');
});

test('the grid resolves its current results and a real mode swap cancels native motion', async ({ page }) => {
  // This helper suite runs only with the emulator. Keep this temporary
  // track configuration inside the test and restore it for later files.
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
  const event = adminDb().doc('config/event');
  const original = (await event.get()).data();
  try {
    await event.set({ ...original, tracks: [{ letter: 'A', name: 'Resolve fixture' }] });
    await openSchedule(page, 1440);
    await expect(page.locator(`${RESULTS}.horizontal-scroll-region`)).toBeVisible();
    const facet = page.getByRole('checkbox', { name: /^panel \(/ });
    await facet.click();
    await expect(facet).toBeChecked();
    await checkResolve(page, 1);
    await page.getByLabel('Sort sessions').selectOption('saved');
    await expect(page.locator(`ul${RESULTS}`)).toBeVisible();
    await expect.poll(() => resolveCount(page)).toBe(2);
    const swap = await page.evaluate(async () => {
      const { applyMode } = await import('/src/lib/modeRuntime.js');
      const mode = globalThis.document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark';
      applyMode(mode);
      const { animation, element } = globalThis.resolves.at(-1);
      return { mode, actual: globalThis.document.documentElement.dataset.mode,
        state: animation.playState, opacity: globalThis.getComputedStyle(element).opacity };
    });
    expect(swap.actual).toBe(swap.mode);
    expect(swap.state).toBe('idle');
    expect(swap.opacity).toBe('1');
    await expect(page.locator('#event-mode-switch')).toHaveCount(0);
    expect(await resolveCount(page)).toBe(2);
    expect(await page.locator(RESULTS).evaluate((element) => element.getAnimations().length)).toBe(0);
  } finally {
    await event.set(original);
  }
});
