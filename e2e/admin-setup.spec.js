// "Set up your event" (ADR 0007 §6) against the seeded emulator.
//
// The unit tests drive the page over a mocked fetch. This spec runs the real
// chain: the readiness policy in webMcpCheckEventReadiness, the page that
// prints it, and the legal sign-off saved through updateEventConfig into
// config/event. The spec sets legal.reviewRequired to true first and puts
// the stored legal block back when it is done, so no later spec meets it.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, signIn } from './helpers.mjs';

test.describe.serial('the setup checklist', () => {
  let storedLegal;

  test.beforeAll(async () => {
    const ref = adminDb().collection('config').doc('event');
    storedLegal = (await ref.get()).data()?.legal ?? null;
    await ref.set({ legal: { ...(storedLegal ?? {}), reviewRequired: true } }, { merge: true });
  });

  test.afterAll(async () => {
    await adminDb().collection('config').doc('event').set({ legal: storedLegal }, { merge: true });
  });

  test('prints the server checks, and an operator marks the legal review complete', async ({ page }) => {
    test.setTimeout(90_000);
    const token = await adminIdToken();
    const before = await callFunction('webMcpCheckEventReadiness', {}, token);
    expect(before.status).toBe(200);
    const items = before.body.checks.items;
    const legalRow = items.find((item) => item.name === 'legal');
    expect(legalRow.state).toBe('action-required');
    const clientIds = ['admins', 'branding', 'seeded', 'legal', 'sender', 'ticketing'];
    const tasks = items.filter((item) => clientIds.includes(item.name));
    const doneBefore = tasks.filter((item) => item.state === 'ready').length;

    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/setup/legal');
    await expect(page.getByRole('heading', { level: 1, name: 'Set up your event' })).toBeVisible();
    await expect(page.getByText(`${doneBefore} of ${tasks.length} steps done`)).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Admin sections' });
    await expect(nav.getByRole('link', { name: 'Set up your event', exact: true })).toHaveAttribute('aria-current', 'page');

    const hosting = page.getByRole('region', { name: 'Hosting status' });
    await expect(hosting.getByRole('heading', { name: 'Google sign-in' })).toBeVisible();
    const authReady = items.find((item) => item.name === 'auth').state === 'ready';
    await expect(hosting.getByText(authReady ? 'Ready' : 'Awaiting Event Runner setup', { exact: true })).toBeVisible();
    await expect(hosting.getByRole('link')).toHaveCount(0);
    await expect(hosting.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Setup steps' }).getByRole('link')).toHaveCount(6);

    const legal = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Approve the privacy policy and terms' }) });
    await expect(legal.getByText('Step 4 of 6')).toBeVisible();
    await expect(legal.getByText('To do', { exact: true })).toBeVisible();
    // The step list beside the step marks this one as the current step.
    await expect(page.getByRole('list', { name: 'Setup steps' }).getByRole('link', { name: /Approve the privacy policy and terms/ })).toHaveAttribute('aria-current', 'step');
    await legal.getByRole('checkbox').check();
    await legal.getByRole('button', { name: 'Approve', exact: true }).click();

    await expect(legal.getByText('Done', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`${doneBefore + 1} of ${tasks.length} steps done`)).toBeVisible();

    const stored = (await adminDb().collection('config').doc('event').get()).data();
    expect(stored.legal.reviewRequired).toBe(false);
    // The merge changed only the flag.
    expect({ ...stored.legal, reviewRequired: true }).toEqual({ ...(storedLegal ?? {}), reviewRequired: true });
  });
});
