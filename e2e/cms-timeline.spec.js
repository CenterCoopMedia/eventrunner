// The timeline editor and the home page's History section (issue #194), on
// the real surface.
//
// "an entry published from the admin appears on the page without a
// rebuild": the seeded operator signs in through the sign-in page, adds an
// entry in the timeline editor, saves a draft, then publishes it from the
// editor. A signed-out browser that already has the home page open sees
// nothing while the entry is a draft, and then sees it as the first History
// entry with no reload: the runtime cmsTimeline listener delivers it.
//
// "the snapshot still renders on first paint": with every Firestore listen
// channel held open and unanswered, the home page stays on the build-time
// snapshot (`data-content-source="snapshot"`), and the History section still
// lists the demo's past editions from the committed timelineData.js.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminIdToken, callFunction, signIn } from './helpers.mjs';

// The demo fixture's past editions (scripts/lib/demo-event.cjs DEMO_TIMELINE),
// oldest first, which is what the committed snapshot and the seed both hold.
const DEMO_TITLES = ['The first meeting', 'Two workshop tracks'];

/** The History section's entry titles, in the order the page draws them. */
function historyTitles(page) {
  return page.getByRole('region', { name: 'History', exact: true }).locator('ol > li h3');
}

test.describe.serial('timeline: admin editor -> publish -> the home page History section', () => {
  const title = `E2E edition ${Date.now()}`;
  let entryId = null;

  test.afterAll(async () => {
    if (!entryId) return;
    const idToken = await adminIdToken();
    await callFunction('cmsDeleteContent', { collection: 'cmsTimeline', docId: entryId }, idToken);
  });

  test('the History section lists the snapshot editions while every listener is held (issue 194)', async ({ page }) => {
    // Hold every Firestore listen channel: no request is answered, so no
    // runtime result can arrive and the page can only be drawing the
    // committed snapshot.
    let held = 0;
    await page.route('**/google.firestore.v1.Firestore/Listen/**', () => {
      held += 1;
    });
    try {
      await page.goto('/');
      await expect(page.locator('article[data-content-source="snapshot"]')).toBeVisible();
      await expect(historyTitles(page)).toHaveText(DEMO_TITLES);
      // The listeners did ask, and nothing answered: the page is still on the
      // snapshot after the listen channel opened.
      await expect.poll(() => held).toBeGreaterThan(0);
      await expect(page.locator('article[data-content-source="snapshot"]')).toBeVisible();
      await expect(historyTitles(page)).toHaveText(DEMO_TITLES);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  test('an entry published from the editor appears on the open home page without a reload (issue 194)', async ({ page, browser }) => {
    const visitor = await browser.newContext();
    try {
      const home = await visitor.newPage();
      await home.goto('/');
      await expect(home.locator('article[data-content-source="live"]')).toBeVisible();
      await expect(historyTitles(home)).toHaveText(DEMO_TITLES);

      // The operator adds the entry and saves a draft.
      await signIn(page, ADMIN_EMAIL);
      await page.goto('/admin/timeline/new/entry');
      await expect(page.getByRole('heading', { level: 1, name: 'New entry' })).toBeVisible();
      await page.getByLabel('Year', { exact: true }).fill('2023');
      await page.getByLabel('Title', { exact: true }).fill(title);
      await page.getByRole('button', { name: 'Save draft' }).click();
      await page.waitForURL((url) => /^\/admin\/timeline\/[0-9a-f-]{36}$/.test(url.pathname));
      entryId = new URL(page.url()).pathname.split('/').at(-1);
      await expect(page.locator('header [data-record-state]')).toHaveText('Draft');

      // A draft is not on the site: a fresh load, live again, lists the
      // demo editions only.
      await home.reload();
      await expect(home.locator('article[data-content-source="live"]')).toBeVisible();
      await expect(historyTitles(home)).toHaveText(DEMO_TITLES);

      // Published from the editor.
      await page.getByRole('button', { name: 'Save and publish' }).click();
      await expect(page.getByText('Published. The public site picks it up live.').first()).toBeVisible();
      await expect(page.locator('header [data-record-state]')).toHaveText('Live');

      // The open page picks it up with no reload: 2023 is the oldest, so it
      // leads the list. The list draws no counter.
      await expect(historyTitles(home)).toHaveText([title, ...DEMO_TITLES]);
      const list = home.getByRole('region', { name: 'History', exact: true }).locator('ol');
      await expect(list).toHaveCSS('list-style-type', 'none');
      await expect(list.locator('li').first().locator('time')).toHaveAttribute('datetime', '2023');
    } finally {
      await visitor.close();
    }
  });
});
