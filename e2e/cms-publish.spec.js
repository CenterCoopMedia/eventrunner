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
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

test.describe.serial('CMS edit -> publish -> public visibility', () => {
  const newSubtitle = `E2E edited subtitle ${Date.now()}`;

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

    // The public page — a fresh navigation, no admin session, no
    // ?preview=1 — now shows the published change.
    await page.goto('/');
    await expect(subtitle).toHaveText(newSubtitle);
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
    await page.goto('/admin/organizations/_new');
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
