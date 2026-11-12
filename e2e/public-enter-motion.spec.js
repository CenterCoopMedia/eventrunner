import { test, expect } from '@playwright/test';

const FIXTURE = '/test-fixtures/public-enter/index.html';

async function observeEnters(page) {
  await page.addInitScript(() => {
    globalThis.enterCount = 0;
    globalThis.document.addEventListener('animationstart', (event) => {
      if (event.animationName !== 'motion-enter') return;
      // Hold the actual first frame so keyboard access and layout are
      // checked before the entrance can finish, even on a slow runner.
      event.target.getAnimations().forEach((animation) => animation.pause());
      if (globalThis.enterSelector && event.target.matches(globalThis.enterSelector)) globalThis.enterCount += 1;
    });
  });
}

async function opensTwice(page, trigger, selector, focus) {
  const body = page.locator(selector);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.evaluate((value) => { globalThis.enterSelector = value; globalThis.enterCount = 0; }, selector);
    await trigger.press('Enter');
    await expect(body).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.enterCount)).toBe(1);
    await page.evaluate(() => globalThis.document.fonts.ready);
    const paused = await body.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return { name: style.animationName, duration: style.animationDuration, height: element.offsetHeight,
        nextTop: element.nextElementSibling?.offsetTop ?? null,
        paused: element.getAnimations().some((animation) => animation.playState === 'paused') };
    });
    expect(paused.name).toBe('motion-enter');
    expect(paused.duration).toBe('0.16s');
    expect(paused.paused).toBe(true);
    for (let tabs = 0; tabs < 12; tabs += 1) {
      await page.keyboard.press('Tab');
      if (await focus.evaluate((element) => element.ownerDocument.activeElement === element)) break;
    }
    await expect(focus).toBeFocused();
    const finished = await body.evaluate((element) => {
      element.getAnimations().forEach((animation) => animation.finish());
      const style = globalThis.getComputedStyle(element);
      return { height: element.offsetHeight, nextTop: element.nextElementSibling?.offsetTop ?? null, opacity: style.opacity, transform: style.transform };
    });
    expect(finished).toEqual({ height: paused.height, nextTop: paused.nextTop, opacity: '1', transform: 'none' });
    await trigger.press('Enter');
    await expect(body).toBeHidden();
  }
}

test('real component bodies enter on every open, keep first-frame access and leave admin still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await observeEnters(page);
  await page.goto(FIXTURE);
  await expect(page.getByRole('heading', { name: 'Public enter component fixture' })).toBeVisible();
  const calling = page.locator('#calling ul');
  expect(await calling.evaluate((element) => globalThis.getComputedStyle(element).animationName)).toBe('none');
  await page.locator('#calling button').press('Enter');
  for (const [id, selector, focus] of [
    ['account', '#account .site-account-menu__content', '#account nav a:first-of-type'],
    ['calendar', '#calendar ul', '#calendar ul button'],
    ['calling', '#calling ul', '#calling ul a'],
    ['faq', '#faq .rich-text', '#faq .rich-text a'],
    ['public-steps', '#public-steps ol', '#public-steps ol a:first-of-type'],
  ]) {
    await opensTwice(page, page.locator(`#${id}`).locator('summary, button').first(), selector, page.locator(focus).first());
  }
  const admin = page.locator('#admin-steps');
  await admin.locator('summary').press('Enter');
  expect(await admin.locator('ol').evaluate((element) => ({ name: globalThis.getComputedStyle(element).animationName, animations: element.getAnimations().length })))
    .toEqual({ name: 'none', animations: 0 });
});

test('the real phone account sheet enters while its native focus is already usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await observeEnters(page);
  await page.goto(FIXTURE);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.evaluate(() => { globalThis.enterSelector = '.site-account-sheet'; globalThis.enterCount = 0; });
    await page.getByRole('button', { name: 'Account', exact: true }).press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Account', exact: true });
    await expect.poll(() => page.evaluate(() => globalThis.enterCount)).toBe(1);
    await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    expect(await sheet.evaluate((element) => globalThis.getComputedStyle(element).animationDuration)).toBe('0.16s');
    await sheet.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeFocused();
  }
});

test('actual site Menu, More, filters and plain text enter without animating a route', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await observeEnters(page);
  await page.goto('/');
  await expect(page.locator('article[data-content-source="live"]')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main', includeHidden: true });
  await opensTwice(page, page.getByRole('button', { name: 'Menu', exact: true }), '.site-header-nav > ul', nav.locator('a').first());
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(nav).toBeVisible();
  await opensTwice(page, nav.locator('.site-nav-more > summary'), '.site-nav-more__links', nav.locator('.site-nav-more__links a').first());
  await page.evaluate(() => { globalThis.enterCount = 0; globalThis.enterSelector = '.motion-enter, .motion-disclosure > :not(summary), .stepper-list'; });
  await nav.locator('a[href="/schedule"]').press('Enter');
  await expect(page.locator('.session-block').first()).toBeVisible();
  expect(await page.evaluate(() => globalThis.enterCount)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await opensTwice(page, page.getByRole('button', { name: 'Filters', exact: true }), '.schedule-facets', page.locator('.schedule-facets input').first());
  await opensTwice(page, page.getByText('Plain text schedule', { exact: true }), 'details.motion-disclosure > pre', page.getByRole('button', { name: 'Copy the schedule as text', exact: true }));
});

test('reduced motion leaves actual site menu and disclosure bodies instant', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('article[data-content-source="live"]')).toBeVisible();
  async function openStill(trigger, selector) {
    await trigger.press('Enter');
    const body = page.locator(selector);
    await expect(body).toBeVisible();
    expect(await body.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return { name: style.animationName, opacity: style.opacity, transform: style.transform };
    })).toEqual({ name: 'none', opacity: '1', transform: 'none' });
    expect(await page.evaluate(() => globalThis.document.getAnimations().length)).toBe(0);
    await trigger.press('Enter');
  }
  await openStill(page.getByRole('button', { name: 'Menu', exact: true }), '.site-header-nav > ul');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStill(page.locator('.site-nav-more > summary'), '.site-nav-more__links');
  await page.getByRole('navigation', { name: 'Main' }).locator('a[href="/schedule"]').press('Enter');
  await expect(page.locator('.session-block').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await openStill(page.getByRole('button', { name: 'Filters', exact: true }), '.schedule-facets');
  await openStill(page.getByText('Plain text schedule', { exact: true }), 'details.motion-disclosure > pre');
});

test('reduced motion opens the component bodies at their end state with no animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(FIXTURE);
  for (const id of ['account', 'calendar', 'faq', 'public-steps', 'admin-steps']) {
    await page.locator(`#${id}`).locator('summary, button').first().press('Enter');
  }
  await page.locator('#calling button').press('Enter');
  await page.locator('#calling button').press('Enter');
  expect(await page.evaluate(() => globalThis.document.getAnimations().length)).toBe(0);
  const states = await page.locator('#account .site-account-menu__content, #calendar ul, #calling ul, #faq .rich-text, .stepper-list').evaluateAll((elements) => elements.map((element) => {
    const style = globalThis.getComputedStyle(element);
    return { opacity: style.opacity, transform: style.transform, name: style.animationName };
  }));
  expect(states).toHaveLength(6);
  expect(states.every((state) => state.opacity === '1' && state.transform === 'none' && state.name === 'none')).toBe(true);
});
