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
import seed from '../scripts/lib/seed.cjs';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, ensureUser, signIn } from './helpers.mjs';
import { editorialId } from '../apps/web/src/admin/editorialId.js';
import { RETRY_DELAY_MS } from '../apps/web/src/lib/retrySubscription.js';

const CONTENT_TIMEOUT_MS = RETRY_DELAY_MS + 15_000;
const { defaultPages } = seed;

test.describe.serial('CMS edit -> publish -> public visibility', () => {
  let newSubtitle;
  // Read from the database before the edit, and when the publish answered,
  // for the version history cases below.
  let oldSubtitle;
  let oldRevision;
  let publishStartedAt;
  let publishFinishedAt;

  const subtitleDoc = () => adminDb().collection('cmsContent').doc('hero__subtitle');

  test('an admin edit is invisible on the public page until published, then appears', async ({ page }) => {
    test.setTimeout(90_000);
    const idToken = await adminIdToken();
    // Other collections may report before cmsContent. Wait for this
    // listener even when the snapshot happens to contain the same text.
    const liveContent = page.locator('article[data-cms-content-source="live"]');
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
    await expect(liveContent).toBeVisible({ timeout: CONTENT_TIMEOUT_MS });
    await expect(subtitle).toBeVisible();
    const before = await subtitle.textContent();
    const original = (await subtitleDoc().get()).data();
    oldSubtitle = original?.value;
    oldRevision = original?.revision;
    expect(typeof oldSubtitle, 'the seeded subtitle holds a stored value').toBe('string');
    expect(typeof oldRevision, 'the seeded subtitle holds a revision').toBe('number');
    expect(before).toBe(oldSubtitle);
    // Include the starting revision so a CI retry that resumes from an
    // earlier attempt always writes a fresh value.
    newSubtitle = `E2E edited subtitle ${Date.now()} from version ${oldRevision}`;
    expect(before).not.toBe(newSubtitle);

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
    await expect(liveContent).toBeVisible({ timeout: CONTENT_TIMEOUT_MS });
    await expect(subtitle).toHaveText(before);

    // Publish the draft (spec §8.4 step 3) — a Firestore revision copy, not
    // a deploy.
    publishStartedAt = Date.now();
    const published = await callFunction('cmsPublish', {
      collection: 'cmsContent',
      docIds: ['hero__subtitle'],
    }, idToken);
    publishFinishedAt = Date.now();
    expect(published.status, `cmsPublish answered 200 (${JSON.stringify(published.body)})`).toBe(200);

    // The public page — a fresh navigation, no admin session, no
    // ?preview=1 — now shows the published change.
    await page.goto('/');
    await expect(liveContent).toBeVisible({ timeout: CONTENT_TIMEOUT_MS });
    await expect(subtitle).toHaveText(newSubtitle, { timeout: CONTENT_TIMEOUT_MS });
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

    // When: an instant inside the observed publish request. Capture both
    // bounds so scheduler delay cannot make the assertion race the server.
    const dateTime = await latest.locator('time').getAttribute('dateTime');
    const versionPublishedAt = Date.parse(dateTime);
    expect(versionPublishedAt).toBeGreaterThanOrEqual(publishStartedAt);
    expect(versionPublishedAt).toBeLessThanOrEqual(publishFinishedAt);

    // What changed: the one field, the stored text before and after.
    const table = latest.getByRole('table', { name: `What changed in version ${live.revision}` });
    const change = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'value', exact: true }) });
    await expect(change).toHaveCount(1);
    await expect(change.getByRole('cell').nth(0)).toHaveText(oldSubtitle);
    await expect(change.getByRole('cell').nth(1)).toHaveText(newSubtitle);
  });

  test('an admin restores the older version, publishes it, and the public page gets the old value', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const liveBeforeRestore = (await subtitleDoc().get()).data();
    expect(liveBeforeRestore.revision).toBe(oldRevision + 1);
    expect(liveBeforeRestore.value).toBe(newSubtitle);

    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/versions/cmsContent/hero__subtitle');
    await expect(page.getByRole('heading', { level: 1, name: 'hero › subtitle' })).toBeVisible();
    const versions = page.getByRole('list', { name: 'Versions' });
    const older = versions.getByRole('listitem').filter({
      has: page.getByRole('heading', { level: 2, name: `Version ${oldRevision}` }),
    });
    await older.getByRole('button', { name: `Restore version ${oldRevision}` }).click();
    const confirm = page.getByRole('region', { name: `Restore version ${oldRevision}?` });
    await expect(confirm).toContainText('The site does not change until you publish.');
    await confirm.getByRole('button', { name: 'Restore as draft' }).click();
    await expect(page.getByText(
      `Version ${oldRevision} is now the draft. The site still shows version ${oldRevision + 1} until you publish.`,
    )).toBeVisible();

    const visitor = await browser.newContext();
    try {
      const publicPage = await visitor.newPage();
      const liveContent = publicPage.locator('article[data-cms-content-source="live"]');
      const subtitle = publicPage.locator('article[data-content-source] > section').first().locator('p').last();
      await publicPage.goto('/');
      await expect(liveContent).toBeVisible({ timeout: CONTENT_TIMEOUT_MS });
      await expect(subtitle).toHaveText(newSubtitle);

      await page.getByRole('button', { name: 'Publish now' }).click();
      await expect(page.getByText('Published. The public site picks it up live.')).toBeVisible();

      await publicPage.reload();
      await expect(liveContent).toBeVisible({ timeout: CONTENT_TIMEOUT_MS });
      await expect(subtitle).toHaveText(oldSubtitle, { timeout: CONTENT_TIMEOUT_MS });
    } finally {
      await visitor.close();
    }
  });
});

// Issue #197 done-when: A staff member formats body copy in the real editor,
// saves and publishes it through the normal CMS flow, and a signed-out
// browser receives the same formatting from the live collection.
test.describe.serial('rich text editor -> publish -> public formatting', () => {
  const stamp = Date.now();
  const question = `Does formatted text round trip ${stamp}?`;
  const field = editorialId(question);
  const docId = `faq_items__${field}`;
  const answer = `Yes, formatting survives ${stamp}.`;
  let idToken;

  test.beforeAll(async () => {
    idToken = await adminIdToken();
  });

  test.afterAll(async () => {
    await callFunction('cmsDeleteContent', {
      collection: 'cmsContent',
      docId,
    }, idToken);
  });

  test('a formatted FAQ answer survives draft save, publish, and public render', async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/content/faq/faq_items/_new');
    await expect(page.getByRole('heading', { level: 1, name: 'New content block' })).toBeVisible();
    await page.getByLabel('Question').fill(question);

    const editor = page.getByRole('textbox', { name: 'Answer' });
    await editor.fill(answer);
    await editor.press('Control+A');
    await page.getByRole('button', { name: 'Bold' }).click();
    await expect(editor.locator('strong')).toHaveText(answer);

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved. It is not public until you publish.')).toBeVisible();
    const draft = (await adminDb().collection('cmsContent_drafts').doc(docId).get()).data();
    expect(draft.answer).toBe(`<p><strong>${answer}</strong></p>`);

    const visitor = await browser.newContext();
    try {
      const publicPage = await visitor.newPage();
      await publicPage.goto('/faq');
      await expect(publicPage.getByText(question, { exact: true })).toHaveCount(0);

      // Save and publish makes two sequential requests: it first updates the
      // draft, then publishes that exact revision. Wait for both responses
      // to finish before starting the UI assertion's normal 10 second
      // budget. A loaded emulator can spend most of that budget returning
      // these small JSON responses even though both operations succeed.
      const updateFinished = page.waitForResponse((response) =>
        response.url().endsWith('/cmsUpdateContent') && response.request().method() === 'POST',
      ).then(async (response) => {
        expect(await response.finished()).toBeNull();
        expect(response.ok()).toBe(true);
      });
      const publishFinished = page.waitForResponse((response) =>
        response.url().endsWith('/cmsPublish') && response.request().method() === 'POST',
      ).then(async (response) => {
        expect(await response.finished()).toBeNull();
        expect(response.ok()).toBe(true);
      });
      await page.getByRole('button', { name: 'Save and publish' }).click();
      await Promise.all([updateFinished, publishFinished]);
      await expect(page.locator('#admin-content').getByRole('status').filter({
        hasText: 'Published. The public site picks it up live.',
      })).toBeVisible();

      await publicPage.reload();
      const disclosure = publicPage.locator('details').filter({
        has: publicPage.getByText(question, { exact: true }),
      });
      await expect(disclosure).toHaveCount(1, { timeout: CONTENT_TIMEOUT_MS });
      await disclosure.getByText(question, { exact: true }).click();
      await expect(disclosure.locator('strong')).toHaveText(answer);
    } finally {
      await visitor.close();
    }
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

  test('the normal client sponsors page can show synthetic test packages (issue 193)', async ({ page }) => {
    const db = adminDb();
    const pageRef = db.doc('cmsPages/sponsors');
    const originalPage = (await pageRef.get()).data();
    const section = defaultPages().find((entry) => entry.id === 'sponsors').sections.find((entry) => entry.id === 'sponsor_packages');
    const names = ['Presenting', 'Supporting', 'Partner'];
    const refs = names.map((_, index) => db.doc(`cmsContent/sponsor_packages__e2e-${index}`));
    try {
      await pageRef.set({ ...originalPage, sections: [...originalPage.sections, section] });
      for (const [index, ref] of refs.entries()) {
        await ref.set({ section: 'sponsor_packages', field: `e2e-${index}`, blockType: 'sponsor_package', name: names[index], price: 'Test only', benefits: '<p>Synthetic emulator package.</p>', visible: true, order: index });
      }
      await page.goto('/sponsors');
      const packages = page.getByRole('region', { name: 'Sponsorship packages', exact: true });
      await expect(packages.getByRole('heading', { level: 3 })).toHaveText(names);
    } finally {
      await Promise.all(refs.map((ref) => ref.delete()));
      await pageRef.set(originalPage);
    }
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
    // blocks: its title band names the section, the page label, and the section label.
    await link.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/admin/content/faq/faq_items');
    await expect(page.getByRole('heading', { level: 1, name: FAQ_ITEMS })).toBeVisible();
    await expect(page.locator('main header').getByText(/^FAQ · Questions and answers · \d+ blocks?$/)).toBeVisible();
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
