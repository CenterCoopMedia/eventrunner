// Admin tiers and the Access page (issues #186 and #187).
//
// The operator half is driven at the HTTP layer — the same
// functions/src/admin/access.cjs endpoints the Access page calls
// (apps/web/src/admin/pages/AdminAccess.jsx) — authenticated as the admin
// bootstrapped by init-event.cjs in global-setup.mjs, exactly as
// cms-publish.spec.js drives the CMS endpoints. The USER-OBSERVABLE half is
// the newly granted staff account signing in through the real Login page
// and meeting the staff rail: the content sections present, the operator
// sections absent, and an operator route refused rather than rendered.
//
// The spec restores config/bootstrap to its seeded state when it is done,
// because every later spec signs in as the seeded operator.
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL, adminDb, adminIdToken, callFunction, ensureUser, idTokenFor, openAdminGroups, signIn,
} from './helpers.mjs';

const STAFF_EMAIL = 'e2e-staff@example.test';
const STAFF_ADDRESS_AS_TYPED = 'E2E-Staff@Example.TEST';

test.describe.serial('admin tiers and the Access page', () => {
  const bootstrapRef = () => adminDb().doc('config/bootstrap');
  let seededBootstrap;
  let operatorToken;
  let staffToken;

  test.beforeAll(async () => {
    seededBootstrap = (await bootstrapRef().get()).data();
    expect(seededBootstrap.adminEmails, 'the seeded operator is on adminEmails').toContain(ADMIN_EMAIL);
    operatorToken = await adminIdToken();
    staffToken = await idTokenFor(await ensureUser(STAFF_EMAIL));
  });

  test.afterAll(async () => {
    if (seededBootstrap) await bootstrapRef().set(seededBootstrap);
  });

  test('a stranger to config/bootstrap has no admin access at all', async () => {
    const list = await callFunction('listAdminAccess', {}, staffToken);
    expect(list.status).toBe(403);
    const draft = await callFunction('cmsGetVersionHistory', { docPath: 'cmsContent/hero__title' }, staffToken);
    expect(draft.status).toBe(403);
  });

  test('an operator grants staff access; the address is lowercased and the change is recorded', async () => {
    const before = (await adminDb().collection('admin_logs').where('action', '==', 'setAdminAccess').get()).size;

    const granted = await callFunction('setAdminAccess', { email: STAFF_ADDRESS_AS_TYPED, tier: 'staff' }, operatorToken);
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    expect(granted.body).toMatchObject({ ok: true, email: STAFF_EMAIL, tier: 'staff', previousTier: null, changed: true });

    const list = await callFunction('listAdminAccess', {}, operatorToken);
    expect(list.status).toBe(200);
    expect(list.body.callerEmail).toBe(ADMIN_EMAIL);
    expect(list.body.accounts).toContainEqual({ email: STAFF_EMAIL, tier: 'staff' });
    expect(list.body.accounts).toContainEqual({ email: ADMIN_EMAIL, tier: 'operator' });

    const stored = (await bootstrapRef().get()).data();
    expect(stored.staffEmails).toContain(STAFF_EMAIL);
    expect(stored.adminEmails).not.toContain(STAFF_EMAIL);

    const logs = await adminDb().collection('admin_logs').where('action', '==', 'setAdminAccess').get();
    expect(logs.size).toBe(before + 1);
    const row = logs.docs.map((doc) => doc.data()).find((data) => data.details?.email === STAFF_EMAIL);
    expect(row).toMatchObject({
      action: 'setAdminAccess',
      docPath: 'config/bootstrap',
      email: ADMIN_EMAIL,
      details: { email: STAFF_EMAIL, tier: 'staff', previousTier: null },
    });
  });

  test('the staff account keeps every content path and is refused the operator paths by the server', async () => {
    // A content read the CMS pages make: staff work.
    const history = await callFunction('cmsGetVersionHistory', { docPath: 'cmsContent/hero__title' }, staffToken);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    // Attendees are staff work too.
    const invites = await callFunction('listSpeakerInvites', {}, staffToken);
    expect(invites.status, JSON.stringify(invites.body)).toBe(200);

    // The branding write the issue names, and the rest of the operator set.
    for (const [name, body] of [
      ['updateTheme', { theme: {} }],
      ['updateFeatures', { features: {} }],
      ['listAdminAccess', {}],
      ['setAdminAccess', { email: 'anyone@example.test', tier: 'operator' }],
      ['listSystemErrors', {}],
    ]) {
      const refused = await callFunction(name, body, staffToken);
      expect(refused.status, `${name} refuses staff`).toBe(403);
      expect(refused.body.error.message).toBe('Operator access required.');
    }
    // Event settings are content — but a CHANGE to the sender block is the
    // operator's. A save that carries the stored sender unchanged, which is
    // what the Event form sends, goes through for staff.
    const stored = (await adminDb().doc('config/event').get()).data();
    const unchanged = await callFunction('updateEventConfig', {
      event: { tagline: `Set by staff ${Date.now()}`, sender: { email: stored.sender.email, name: stored.sender.name ?? null, replyTo: stored.sender.replyTo ?? null } },
    }, staffToken);
    expect(unchanged.status, JSON.stringify(unchanged.body)).toBe(200);
    const sender = await callFunction('updateEventConfig', { event: { sender: { email: 'x@example.test' } } }, staffToken);
    expect(sender.status).toBe(403);
    expect(sender.body.error.message).toBe('sender: operator access required');
    // The social sharing card is branding: pointing it elsewhere is refused
    // the same way, and the stored value stands.
    const card = await callFunction('updateEventConfig', { event: { seo: { defaultOgImagePath: 'cms-images/x/card.png' } } }, staffToken);
    expect(card.status).toBe(403);
    expect(card.body.error.message).toBe('seo.defaultOgImagePath: operator access required');

    // Branding through the media library is the operator's too.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const branding = await callFunction('mediaUpload', {
      folder: 'branding', contentType: 'image/png', filename: 'logo.png', data: png.toString('base64'),
    }, staffToken);
    expect(branding.status).toBe(403);
    expect(branding.body.error.message).toBe('branding: operator access required');
    const content = await callFunction('mediaUpload', {
      folder: 'cms-images', contentType: 'image/png', filename: 'hero.png', data: png.toString('base64'),
    }, staffToken);
    expect(content.status, JSON.stringify(content.body)).toBe(200);
  });

  test('the staff account signs in and sees the staff rail; an operator route is refused, not rendered', async ({ page }) => {
    await signIn(page, STAFF_EMAIL);
    await page.goto('/admin');
    const nav = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(nav).toBeVisible();
    // /admin opens on the overview, a staff section (issue #179).
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await openAdminGroups(page);
    for (const label of ['Overview', 'Pages', 'Sessions', 'Speakers', 'Attendees', 'Materials', 'Event']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    for (const label of ['Features', 'Branding', 'Access', 'System errors']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    }
    await expect(page.locator('[data-admin-tier="staff"]')).toHaveText('Staff');

    // Refused, in the shell, with the rail still beside it.
    await page.goto('/admin/branding');
    await expect(page.getByRole('heading', { name: 'This section needs operator access' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Branding' })).toHaveCount(0);
    await expect(nav).toBeVisible();

    // And a content editor still opens.
    await page.goto('/admin/pages');
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
  });

  test('the last operator cannot be removed or demoted, the caller included', async () => {
    // Leave the seeded operator as the only one, through the endpoint.
    const others = seededBootstrap.adminEmails.filter((email) => email !== ADMIN_EMAIL);
    for (const email of others) {
      const removed = await callFunction('setAdminAccess', { email, tier: 'none' }, operatorToken);
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    }
    const onlyOne = await callFunction('listAdminAccess', {}, operatorToken);
    expect(onlyOne.body.accounts.filter((account) => account.tier === 'operator')).toEqual([
      { email: ADMIN_EMAIL, tier: 'operator' },
    ]);

    for (const tier of ['none', 'staff']) {
      const refused = await callFunction('setAdminAccess', { email: ADMIN_EMAIL, tier }, operatorToken);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('last-operator');
    }
    expect((await bootstrapRef().get()).data().adminEmails).toContain(ADMIN_EMAIL);

    // Grant a second operator, and the first may step down.
    const second = await callFunction('setAdminAccess', { email: STAFF_EMAIL, tier: 'operator' }, operatorToken);
    expect(second.status).toBe(200);
    expect(second.body.previousTier).toBe('staff');
    const stepDown = await callFunction('setAdminAccess', { email: ADMIN_EMAIL, tier: 'staff' }, operatorToken);
    expect(stepDown.status).toBe(200);
    // The demoted caller is now refused the page they were just on.
    const refusedNow = await callFunction('listAdminAccess', {}, operatorToken);
    expect(refusedNow.status).toBe(403);

    // Restore: the promoted staff account puts the seeded operator back.
    const restore = await callFunction('setAdminAccess', { email: ADMIN_EMAIL, tier: 'operator' }, staffToken);
    expect(restore.status).toBe(200);
    for (const email of others) {
      const back = await callFunction('setAdminAccess', { email, tier: 'operator' }, operatorToken);
      expect(back.status).toBe(200);
    }
  });

  // Issue #331. Two synthetic accounts: one granted through the real form
  // with an end time days away, one granted through the endpoint with an
  // end time seconds away, so the test can wait the end out. The short one
  // must work before its end and stop at it on the server (with the token
  // it held before), in the rules (the panel's own probe refuses it), and
  // on the operator's Access page.
  test('a staff grant with an end time works until that time and then stops at once (issue 331)', async ({ page, browser }) => {
    test.setTimeout(150_000);
    const LONG_EMAIL = 'e2e-demo-long@example.test';
    const SHORT_EMAIL = 'e2e-demo-short@example.test';
    const shortToken = await idTokenFor(await ensureUser(SHORT_EMAIL));

    // Operator access never ends, and an end time must be in the future.
    const operatorEnd = await callFunction('setAdminAccess', { email: SHORT_EMAIL, tier: 'operator', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, operatorToken);
    expect(operatorEnd.status).toBe(400);
    const pastEnd = await callFunction('setAdminAccess', { email: SHORT_EMAIL, tier: 'staff', expiresAt: new Date(Date.now() - 1000).toISOString() }, operatorToken);
    expect(pastEnd.status).toBe(400);
    expect((await bootstrapRef().get()).data().staffEmails ?? []).not.toContain(SHORT_EMAIL);

    // The operator grants the long one through the Access page form.
    const operatorContext = await browser.newContext();
    const operatorPage = await operatorContext.newPage();
    await signIn(operatorPage, ADMIN_EMAIL);
    await operatorPage.goto('/admin/access');
    await expect(operatorPage.getByRole('heading', { level: 1, name: 'Access' })).toBeVisible();
    const longEnd = new Date(Date.now() + 2 * 24 * 3_600_000);
    const pad = (n) => String(n).padStart(2, '0');
    const localValue = `${longEnd.getFullYear()}-${pad(longEnd.getMonth() + 1)}-${pad(longEnd.getDate())}T${pad(longEnd.getHours())}:${pad(longEnd.getMinutes())}`;
    await operatorPage.getByLabel('Email address').fill(LONG_EMAIL);
    await operatorPage.getByLabel('Access ends (optional)').fill(localValue);
    await operatorPage.getByRole('button', { name: 'Grant access' }).click();
    const surface = operatorPage.getByRole('region', { name: new RegExp(`^Grant staff access to ${LONG_EMAIL} until `) });
    await expect(surface).toContainText('An end time does not make the account read-only.');
    await surface.getByRole('button', { name: 'Grant staff access' }).click();
    // The line on the page; the toast repeats it.
    await expect(operatorPage.getByText(new RegExp(`^Staff access granted to ${LONG_EMAIL} until `)).first()).toBeVisible();
    const stored = (await bootstrapRef().get()).data();
    expect(stored.staffEmails).toContain(LONG_EMAIL);
    // Minute precision in the field, in the browser's zone: the same minute.
    expect(Math.abs(stored.staffExpiry[LONG_EMAIL].toMillis() - longEnd.getTime())).toBeLessThan(60_000);

    // The short one, through the endpoint, ends in a few seconds.
    const shortEnd = new Date(Date.now() + 25_000);
    const granted = await callFunction('setAdminAccess', { email: SHORT_EMAIL, tier: 'staff', expiresAt: shortEnd.toISOString() }, operatorToken);
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    expect(granted.body).toMatchObject({ tier: 'staff', previousTier: null, changed: true, expiresAt: shortEnd.toISOString(), previousExpiresAt: null });
    const row = (await adminDb().collection('admin_logs').where('action', '==', 'setAdminAccess').get())
      .docs.map((doc) => doc.data()).find((data) => data.details?.email === SHORT_EMAIL);
    expect(row.details).toEqual({ email: SHORT_EMAIL, tier: 'staff', previousTier: null, expiresAt: shortEnd.toISOString(), previousExpiresAt: null });

    const listed = await callFunction('listAdminAccess', {}, operatorToken);
    expect(listed.body.accounts).toContainEqual({ email: SHORT_EMAIL, tier: 'staff', expiresAt: shortEnd.toISOString(), expiryState: 'active' });
    expect(listed.body.accounts).toContainEqual(expect.objectContaining({ email: LONG_EMAIL, tier: 'staff', expiryState: 'active' }));

    // Before the end: the server and the rules admit the account as staff.
    const before = await callFunction('cmsGetVersionHistory', { docPath: 'cmsContent/hero__title' }, shortToken);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    await signIn(page, SHORT_EMAIL);
    await page.goto('/admin');
    await expect(page.locator('[data-admin-tier="staff"]')).toHaveText('Staff');
    expect(Date.now(), 'the staff rail was reached before the end time').toBeLessThan(shortEnd.getTime());

    // Wait the end out.
    await page.waitForTimeout(Math.max(0, shortEnd.getTime() - Date.now()) + 1000);

    // The server refuses the token it admitted a moment ago.
    const after = await callFunction('cmsGetVersionHistory', { docPath: 'cmsContent/hero__title' }, shortToken);
    expect(after.status).toBe(403);
    // The rules refuse the panel's probe: a reload is refused, not drawn.
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'You don’t have admin access' })).toBeVisible();
    // The long grant still works.
    const longToken = await idTokenFor(await ensureUser(LONG_EMAIL));
    const stillWorks = await callFunction('cmsGetVersionHistory', { docPath: 'cmsContent/hero__title' }, longToken);
    expect(stillWorks.status, JSON.stringify(stillWorks.body)).toBe(200);

    // The operator sees the ended grant, by the server's clock.
    await operatorPage.reload();
    const shortRow = operatorPage.getByRole('row', { name: new RegExp(SHORT_EMAIL) });
    await expect(shortRow).toContainText('Ended');
    await expect(shortRow).toContainText('No access now.');
    // The emulator runs no scheduled functions, so the sweep never takes it off here.
    await expect(shortRow).toContainText('The account leaves this list within a minute.');
    const longRow = operatorPage.getByRole('row', { name: new RegExp(LONG_EMAIL) });
    await expect(longRow).toContainText('Access ends');
    await operatorContext.close();

    // Renewing the ended grant brings it back; removing both cleans up.
    const renewed = await callFunction('setAdminAccess', { email: SHORT_EMAIL, tier: 'staff', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, operatorToken);
    expect(renewed.status).toBe(200);
    expect((await callFunction('cmsGetVersionHistory', { docPath: 'cmsContent/hero__title' }, shortToken)).status).toBe(200);
    for (const email of [SHORT_EMAIL, LONG_EMAIL]) {
      const removed = await callFunction('setAdminAccess', { email, tier: 'none' }, operatorToken);
      expect(removed.status).toBe(200);
    }
    expect((await callFunction('cmsGetVersionHistory', { docPath: 'cmsContent/hero__title' }, shortToken)).status).toBe(403);
    expect((await bootstrapRef().get()).data().staffExpiry).toBeUndefined();
  });

  test('revoking access removes the account at once', async () => {
    const revoked = await callFunction('setAdminAccess', { email: STAFF_EMAIL, tier: 'none' }, operatorToken);
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ tier: null, previousTier: 'operator', changed: true });

    const list = await callFunction('listAdminAccess', {}, operatorToken);
    expect(list.body.accounts.map((account) => account.email)).not.toContain(STAFF_EMAIL);
    const gone = await callFunction('cmsGetVersionHistory', { docPath: 'cmsContent/hero__title' }, staffToken);
    expect(gone.status).toBe(403);
  });
});
