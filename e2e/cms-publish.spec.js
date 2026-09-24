// Admin CMS edit → publish → public visibility (issue #38 done-when b).
//
// The admin half (draft edit, publish) is driven at the HTTP layer — the
// same functions/src/cms/{content,publish}.cjs endpoints the admin UI
// itself calls (apps/web/src/admin/adminApi.js), authenticated as the admin
// bootstrapped by init-event.cjs in global-setup.mjs. That mirrors this
// repo's own precedent for pipeline steps that are not the thing under test
// (scripts/dev/invite-smoke.mjs drives the whole speaker pipeline the same
// way). The USER-OBSERVABLE half — a real browser loading the public home
// page and seeing the new copy — is what this spec actually drives through
// Playwright, which is the part no API call could stand in for.
//
// The same edit then has a history (issue #195): the admin's version
// history page, in a signed-in browser, reads the publish back as a
// version with its time, its account, and the one field it changed.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, ensureUser, signIn } from './helpers.mjs';

test.describe.serial('CMS edit -> publish -> public visibility', () => {
  const newSubtitle = `E2E edited subtitle ${Date.now()}`;
  // Read from the database before the edit, and when the publish answered,
  // for the version history cases below.
  let oldSubtitle;
  let publishedAt;

  const subtitleDoc = () => adminDb().collection('cmsContent').doc('hero__subtitle');

  test('an admin edit is invisible on the public page until published, then appears', async ({ page }) => {
    const idToken = await adminIdToken();
    // ContentContext.jsx's own `source` ('snapshot' | 'live'), surfaced as
    // a data attribute on Home.jsx's root element purely for this spec
    // (see that file's comment). Both the committed build-time snapshot and
    // a freshly-seeded project's live cmsContent render IDENTICAL text —
    // seed-demo-event.cjs layers the exact same fixture generate-content.cjs
    // --demo bakes into the snapshot (spec §8.6 hygiene) — so no text on
    // this page can tell "still on the snapshot" apart from "the runtime
    // listener resolved" the way this attribute can.
    const liveContent = page.locator('article[data-content-source="live"]');
    // Home.jsx's lead section is always the FIRST <section> under the
    // content article, and the hero subtitle is always the LAST <p> inside
    // it — an optional tagline paragraph (present here as an empty <p>,
    // since this fixture's eventConfig has no tagline) comes before it, and
    // the CTAs render as a <div>, not a <p>. That structural position holds
    // independent of restyle-era utility classes, unlike the aria-label on
    // the section itself: it reads "Introduction" only when the CMS hero
    // title happens to equal eventConfig.name, which is NOT the case for
    // this fixture (seed-demo-event.cjs's demo title overlay differs from
    // e2e/fixtures/answers.json's event name), so the section instead gets
    // aria-labelledby pointing at that (fixture-specific) heading text —
    // not a stable string to match on here.
    const heroSection = page.locator('article[data-content-source] > section').first();
    const subtitle = heroSection.locator('p').last();

    // Baseline: wait for the live cmsContent overlay to actually resolve —
    // not just whatever the build-time snapshot happens to render on first
    // paint — before trusting anything read off this page as "live".
    await page.goto('/');
    await expect(liveContent).toBeVisible();
    await expect(subtitle).toBeVisible();
    const before = await subtitle.textContent();
    expect(before).not.toBe(newSubtitle);
    oldSubtitle = (await subtitleDoc().get()).data()?.value;
    expect(typeof oldSubtitle, 'the seeded subtitle holds a stored value').toBe('string');

    // Edit the hero subtitle block. This writes the DRAFT revision only —
    // the two-revision model (spec §8.4) — so the live/public doc, and this
    // page, must not change yet.
    const updated = await callFunction('cmsUpdateContent', {
      collection: 'cmsContent',
      section: 'hero',
      field: 'subtitle',
      fields: { value: newSubtitle },
    }, idToken);
    expect(updated.status, `cmsUpdateContent answered 200 (${JSON.stringify(updated.body)})`).toBe(200);
    expect(updated.body?.status).toBe('dirty');

    // A reload restarts ContentContext.jsx from its build-time snapshot
    // (ContentProvider's overlay slots reset to null) and re-subscribes.
    // Wait for the live overlay to resolve again before trusting an
    // "unchanged" reading of the subtitle — otherwise this assertion could
    // pass trivially off the still-rendering snapshot without the live
    // cmsContent listener (which is what would actually leak a draft, if
    // isolation were broken) ever having reported in.
    await page.reload();
    await expect(liveContent).toBeVisible();
    await expect(subtitle).toHaveText(before);

    // Publish the draft (spec §8.4 step 3) — a Firestore revision copy, not
    // a deploy.
    const published = await callFunction('cmsPublish', {
      collection: 'cmsContent',
      docIds: ['hero__subtitle'],
    }, idToken);
    expect(published.status, `cmsPublish answered 200 (${JSON.stringify(published.body)})`).toBe(200);
    publishedAt = Date.now();

    // The public page — a fresh navigation, no admin session, no
    // ?preview=1 — now shows the published change.
    await page.goto('/');
    await expect(subtitle).toHaveText(newSubtitle);
  });

  test('the edit and the publish read back as a version: what changed, when, and by which account', async ({ page }) => {
    const live = (await subtitleDoc().get()).data();
    expect(live.value).toBe(newSubtitle);

    // The record list, filtered to content blocks, then the one record.
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/versions?collection=cmsContent');
    await expect(page.getByRole('heading', { level: 1, name: 'Version history' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Collection' })).toHaveValue('cmsContent');
    await page.getByRole('searchbox', { name: 'Search by name or id' }).fill('hero__subtitle');
    const records = page.getByRole('region', { name: 'Records' });
    await expect(records.getByRole('link')).toHaveCount(1);
    await records.getByRole('link').click();
    await expect(page).toHaveURL(/\/admin\/versions\/cmsContent\/hero__subtitle$/);

    const versions = page.getByRole('list', { name: 'Versions' }).getByRole('listitem');
    const latest = versions.first();
    // Its number is the live document's revision, read, never assumed.
    await expect(latest.getByRole('heading', { level: 2 })).toHaveText(`Version ${live.revision}`);
    await expect(latest).toContainText(`by ${ADMIN_EMAIL}`);

    // When: an instant within five minutes of the publish. A Timestamp sent
    // unconverted would give no parseable time here.
    const dateTime = await latest.locator('time').getAttribute('dateTime');
    expect(Math.abs(Date.parse(dateTime) - publishedAt)).toBeLessThan(5 * 60_000);

    // What changed: the one field, the stored text before and after.
    const table = latest.getByRole('table', { name: `What changed in version ${live.revision}` });
    const change = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'value', exact: true }) });
    await expect(change).toHaveCount(1);
    await expect(change.getByRole('cell').nth(0)).toHaveText(oldSubtitle);
    await expect(change.getByRole('cell').nth(1)).toHaveText(newSubtitle);
  });
});

// The organizations editor (issue #192) and the sponsor page (issue #193),
// on the real surface: the seeded operator signs in through the sign-in
// page, creates an organization in the admin editor and publishes it from
// there, and a signed-out browser finds it in its tier group on the public
// sponsors page and on its own page at its slug. The type check and the
// duplicate address are proven against the deployed endpoint, at the save.
test.describe.serial('organizations: admin editor -> publish -> sponsor pages', () => {
  const stamp = Date.now();
  const name = `E2E Org ${stamp}`;
  const slug = `e2e-org-${stamp}`;
  let idToken;

  test.beforeAll(async () => {
    idToken = await adminIdToken();
  });

  test.afterAll(async () => {
    await callFunction('cmsDeleteContent', { collection: 'cmsOrganizations', docId: slug }, idToken);
  });

  test('an organization published from the editor appears in its tier group (issue 192)', async ({ page, browser }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/organizations/new/organization');
    await expect(page.getByRole('heading', { level: 1, name: 'New organization' })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await expect(page.getByLabel(/^Page address/)).toHaveValue(slug);
    await page.getByLabel(/^Tier/).fill('supporting');
    await page.getByRole('button', { name: 'Save and publish' }).click();

    await page.waitForURL((url) => url.pathname === `/admin/organizations/${slug}`);
    await expect(page.locator('header [data-record-state]')).toHaveText('Live');

    const visitor = await browser.newContext();
    try {
      const publicPage = await visitor.newPage();
      await publicPage.goto('/sponsors');
      const group = publicPage.getByRole('region', { name: 'supporting', exact: true });
      await expect(group.getByText(name, { exact: true })).toBeVisible();
    } finally {
      await visitor.close();
    }
  });

  test('a name that is not text is refused at save, naming the field (issue 192)', async () => {
    const badId = `e2e-bad-${stamp}`;
    const refused = await callFunction('cmsCreateContent', {
      collection: 'cmsOrganizations',
      docId: badId,
      fields: { name: 42 },
      visible: true,
    }, idToken);
    expect(refused.status).toBe(400);
    expect(refused.body?.error?.message).toMatch(/^name: /);
    const draft = await adminDb().collection('cmsOrganizations_drafts').doc(badId).get();
    expect(draft.exists).toBe(false);
  });

  test('the sponsor has its own page, and a second organization is refused its address at save (issue 193)', async ({ browser }) => {
    const visitor = await browser.newContext();
    try {
      const publicPage = await visitor.newPage();
      await publicPage.goto(`/sponsors/${slug}`);
      await expect(publicPage.getByRole('heading', { level: 1 })).toHaveText(name);
    } finally {
      await visitor.close();
    }

    const draftRef = adminDb().collection('cmsOrganizations_drafts').doc(slug);
    const before = (await draftRef.get()).data();
    const second = await callFunction('cmsCreateContent', {
      collection: 'cmsOrganizations',
      docId: slug,
      fields: { name: 'Another E2E Org', tier: 'partner' },
      visible: true,
    }, idToken);
    expect(second.status).toBe(409);
    expect(second.body?.error?.message).toBe(`slug: another organization already uses "${slug}"`);
    expect((await draftRef.get()).data()).toEqual(before);
  });

  test('the sponsors page shows the demo sponsorship packages (issue 193)', async ({ page }) => {
    await page.goto('/sponsors');
    const packages = page.getByRole('region', { name: 'Sponsorship packages', exact: true });
    await expect(packages.getByRole('heading', { level: 3 })).toHaveText(['Presenting', 'Supporting', 'Partner']);
  });
});

// The editor tour and the section edit links (issue #198), on the real
// surface: the seeded operator signs in through the sign-in page, and every
// move below is one a person makes in the browser.
//
// The done line: the tour can be completed by keyboard, and a section edit
// link opens the correct editor. The seeded FAQ page is a deep link, so the
// profile setup nudge (ProfileSetupRedirect, which fires on / only) never
// takes the page away mid-test.
test.describe('editor tour and section edit links', () => {
  const FAQ_ITEMS = 'Questions and answers';

  test('a section edit link is absent for a visitor and opens that section’s editor for an admin', async ({ page }) => {
    test.setTimeout(90_000);
    // Signed out: the page draws its sections and no link.
    await page.goto('/faq');
    await expect(page.getByRole('heading', { level: 2, name: FAQ_ITEMS })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Edit section/ })).toHaveCount(0);

    await signIn(page, ADMIN_EMAIL);
    await page.goto('/faq');
    const link = page.getByRole('link', { name: `Edit section: ${FAQ_ITEMS}` });
    await expect(link).toBeVisible();
    await expect(link).toHaveText('Edit section');
    await expect(link).toHaveAttribute('href', '/admin/content/faq/faq_items');
    // It follows its heading, in the section's head.
    const headRow = page.getByRole('heading', { level: 2, name: FAQ_ITEMS }).locator('..');
    await expect(headRow.getByRole('link', { name: `Edit section: ${FAQ_ITEMS}` })).toBeVisible();

    // Enter on the focused link opens the editor that holds the section's
    // blocks: its title band names the section, the page and the section id.
    await link.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/admin/content/faq/faq_items');
    await expect(page.getByRole('heading', { level: 1, name: FAQ_ITEMS })).toBeVisible();
    await expect(page.locator('main header').getByText(/^faq · faq_items · \d+ blocks?$/)).toBeVisible();
    await expect(page.getByText('No such section')).toHaveCount(0);
  });

  test('the tour is walked to its end with Tab and Enter alone, and stays ended after a reload', async ({ page }) => {
    test.setTimeout(90_000);
    // A fresh browser context: nothing is stored, so this is a first visit.
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    const tour = page.getByRole('complementary', { name: 'Admin tour' });
    await expect(tour).toBeVisible();

    // It sits above the page's title band and never under it.
    const tourBox = await tour.boundingBox();
    const bandBox = await page.locator('main header.admin-job-line').boundingBox();
    expect(tourBox.y + tourBox.height).toBeLessThanOrEqual(bandBox.y);

    /** Press Tab until the focused control reads one of `names`, at most 80 times. */
    async function tabTo(names) {
      for (let presses = 0; presses < 80; presses += 1) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => globalThis.document.activeElement?.textContent?.trim() ?? '');
        if (names.includes(focused)) return focused;
      }
      throw new Error(`Tab did not reach ${names.join(' or ')} within 80 presses`);
    }

    const stepLine = tour.getByText(/^Step \d+ of \d+$/);
    await expect(stepLine).toHaveText(/^Step 1 of \d+$/);
    const total = Number((await stepLine.textContent()).match(/of (\d+)/)[1]);
    for (let step = 1; step <= total; step += 1) {
      await expect(stepLine).toHaveText(`Step ${step} of ${total}`);
      const pressed = await tabTo(['Next', 'Finish tour']);
      expect(pressed).toBe(step === total ? 'Finish tour' : 'Next');
      await page.keyboard.press('Enter');
      if (step < total) {
        // The new step's heading takes the focus, and shows it.
        const heading = tour.getByRole('heading', { level: 2 });
        await expect(heading).toBeFocused();
        expect(await heading.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      }
    }

    // Finished: the tour closes and the focus returns to the rail.
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Take the tour' })).toBeFocused();
    const uid = await ensureUser(ADMIN_EMAIL);
    expect(
      await page.evaluate((key) => globalThis.localStorage.getItem(key), `eventrunner.adminTour.v1:${uid}`),
    ).toBe('done');

    // A reload keeps it ended. The Overview's figures load after the shell,
    // so by the time they show, an open tour would have drawn too.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Event figures' })).toBeVisible();
    await expect(tour).toHaveCount(0);

    // And Take the tour opens it again at step 1, where Escape ends it.
    await page.getByRole('button', { name: 'Take the tour' }).click();
    await expect(tour.getByRole('heading', { level: 2, name: 'Welcome to the admin panel' })).toBeFocused();
    await expect(stepLine).toHaveText(`Step 1 of ${total}`);
    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Take the tour' })).toBeFocused();
  });
});
