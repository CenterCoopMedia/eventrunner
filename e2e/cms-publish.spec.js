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
import { adminIdToken, callFunction } from './helpers.mjs';

test.describe.serial('CMS edit -> publish -> public visibility', () => {
  const newSubtitle = `E2E edited subtitle ${Date.now()}`;

  test('an admin edit is invisible on the public page until published, then appears', async ({ page }) => {
    const idToken = await adminIdToken();

    // Baseline: the seeded/demo subtitle is live.
    await page.goto('/');
    const subtitle = page.locator('p.mt-4.max-w-prose');
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

    await page.reload();
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
