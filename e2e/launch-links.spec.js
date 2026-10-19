// Launch rehearsal gaps, on the real surface (no issue number; a launch
// rehearsal for a site opening with tickets and a pitch call only).
//
//   1. A hero button saved with a destination whose section is switched off
//      ("Explore the program" → /schedule, schedule off) drew in the home
//      lead and led to "This event doesn't have a public schedule". The
//      editor now warns, the save still succeeds, and the public home page
//      draws the button only while the schedule is on.
//   2. The admin Pages list said "Live" on every row and nothing about
//      whether a reader could open the page. Each row now says Visible or
//      Hidden, and a built-in page whose feature is off says why.
//   3. The home body drew the seeded footer section under a "Footer links"
//      heading. The site footer draws it now, and the body does not.
//   4. A fresh site seeds three pages hidden, and a hero button to a hidden
//      page, or to an address no page has, led to the 404 page. The editor
//      warns, and the public home page does not draw the button.
//
// config/features is restored and the new block deleted when the file is
// done, because later specs read the flags and the home page.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

const LABEL = 'Explore the program';
const NO_PAGE_LABEL = 'Read the speaker notes';
const NO_PAGE_WARNING = 'No page has this address. The public site does not show this link until a visible page does.';
const WARNING = 'Public schedule is off in Features. The public site does not show this link until you turn it on.';

async function endTour(page) {
  const button = page.getByRole('button', { name: 'End tour', exact: true });
  if (await button.isVisible().catch(() => false)) await button.click();
}

async function setSchedule(on) {
  await adminDb().collection('config').doc('features').set({ schedule: on }, { merge: true });
}

async function findCta(label = LABEL) {
  const snap = await adminDb().collection('cmsContent').where('section', '==', 'hero').get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).find((doc) => doc.label === label) ?? null;
}

test.describe.serial('links to a switched-off section, page visibility, and the footer links', () => {
  let seededFeatures;
  let ctaField = null;
  let noPageField = null;

  test.beforeAll(async () => {
    seededFeatures = (await adminDb().collection('config').doc('features').get()).data();
    await setSchedule(false);
  });

  test.afterAll(async () => {
    for (const field of [ctaField, noPageField].filter(Boolean)) {
      await callFunction('cmsDeleteContent', { section: 'hero', field }, await adminIdToken());
    }
    await adminDb().collection('config').doc('features').set(seededFeatures);
  });

  test('the editor warns, the save succeeds, and the home page draws the button only while the schedule is on', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/content/home/hero/_new');
    await endTour(page);
    await page.getByLabel('Block type').selectOption('cta');
    await page.getByLabel('Button text').fill(LABEL);
    const destination = page.getByLabel('Destination');
    await destination.fill('/schedule');
    const warning = page.getByText(WARNING);
    await expect(warning).toBeVisible();
    // The field names the warning, so a screen reader hears it with the field.
    const warningId = await warning.getAttribute('id');
    await expect(destination).toHaveAttribute('aria-describedby', new RegExp(warningId));
    await page.getByRole('button', { name: 'Save and publish' }).click();
    await expect.poll(async () => (await findCta())?.revision ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
    ctaField = (await findCta()).field;

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const visitor = await context.newPage();
    await visitor.goto('/');
    const main = visitor.getByRole('main');
    await expect(visitor.locator('article[data-cms-content-source="live"]')).toBeVisible({ timeout: 30_000 });
    await expect(main.locator('h1')).toBeVisible();
    await expect(main.getByRole('link', { name: LABEL })).toHaveCount(0);

    // The block is stored and published, so switching the schedule on draws
    // it with no edit, and it leads to the schedule.
    await setSchedule(true);
    await expect(main.getByRole('link', { name: LABEL })).toHaveAttribute('href', '/schedule', { timeout: 20_000 });
    await setSchedule(false);
    await expect(main.getByRole('link', { name: LABEL })).toHaveCount(0, { timeout: 20_000 });
    await context.close();
  });

  test('a hero button to an address no page has is saved with a warning and not drawn', async ({ page, browser }) => {
    test.setTimeout(120_000);
    // The hero section holds four blocks at most; free the one the test
    // above added.
    if (ctaField) {
      await callFunction('cmsDeleteContent', { section: 'hero', field: ctaField }, await adminIdToken());
      ctaField = null;
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/content/home/hero/_new');
    await endTour(page);
    await page.getByLabel('Block type').selectOption('cta');
    await page.getByLabel('Button text').fill(NO_PAGE_LABEL);
    await page.getByLabel('Destination').fill('/speaker-notes');
    await expect(page.getByText(NO_PAGE_WARNING)).toBeVisible();
    await page.getByRole('button', { name: 'Save and publish' }).click();
    await expect.poll(async () => (await findCta(NO_PAGE_LABEL))?.revision ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
    noPageField = (await findCta(NO_PAGE_LABEL)).field;

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const visitor = await context.newPage();
    await visitor.goto('/');
    await expect(visitor.locator('article[data-cms-content-source="live"]')).toBeVisible({ timeout: 30_000 });
    await expect(visitor.getByRole('main').locator('h1')).toBeVisible();
    await expect(visitor.getByRole('main').getByRole('link', { name: NO_PAGE_LABEL })).toHaveCount(0);
    await context.close();
  });

  test('the Pages list says Visible or Hidden on every row, and why a built-in page is hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/pages');
    await endTour(page);
    const main = page.getByRole('main');
    const rows = main.locator('li').filter({ has: page.getByRole('link', { name: 'Edit this page' }) });
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(3);
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i).getByText(/^(Visible|Hidden)$/)).toHaveCount(1);
    }
    const schedule = rows.filter({ has: page.getByRole('link', { name: /^(Schedule|Program)$/ }) }).first();
    await expect(schedule.getByText('Hidden', { exact: true })).toBeVisible();
    await expect(schedule.getByText('Public schedule is off in Features. The public site hides this page.')).toBeVisible();
  });

  test('the footer section draws in the site footer on every page and not in the home body', async ({ page }) => {
    const home = (await adminDb().collection('cmsPages').doc('home').get()).data();
    const section = home.sections.find((entry) => entry.id === 'footer');
    const link = (await adminDb().collection('cmsContent').doc('footer__contact_link').get()).data();
    expect(section, 'the seeded home page states a footer section').toBeTruthy();
    for (const path of ['/', '/faq']) {
      await page.goto(path);
      await expect(page.getByRole('main').locator('h1')).toBeVisible({ timeout: 30_000 });
      const footer = page.getByRole('contentinfo');
      const nav = footer.getByRole('navigation', { name: section.label });
      await expect(nav.getByRole('link', { name: link.label, exact: true })).toHaveAttribute('href', link.url);
      await expect(page.getByRole('main').getByRole('heading', { name: section.label, exact: true })).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('link', { name: link.label, exact: true })).toHaveCount(0);
    }
  });
});
