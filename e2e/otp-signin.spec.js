// OTP sign-in (issue #38 done-when a): request a code → read it from the
// captured-mail file the console email provider appends to (see
// e2e/helpers.mjs) → verify → signed-in state, driven through the real
// Login page end to end.
import { test, expect } from '@playwright/test';
import { mailFileSize, waitForOtpCode } from './helpers.mjs';

test.describe.serial('OTP sign-in', () => {
  const email = `otp-e2e-${Date.now()}@example.test`;

  test('request code, read it from the mail file, verify, and stay signed in', async ({ page }) => {
    const since = mailFileSize();

    await page.goto('/signin');
    const emailInput = page.locator('#signin-email');
    await emailInput.waitFor({ state: 'visible' });
    await emailInput.fill(email);
    await page.getByRole('button', { name: /email me a code/i }).click();

    // Step 2 renders once sendOtpCode resolves.
    const codeInput = page.locator('#signin-code');
    await codeInput.waitFor({ state: 'visible' });

    const code = await waitForOtpCode(since, email, 30000);
    expect(code, 'the OTP code was captured from the mail file').toBeTruthy();

    await codeInput.fill(code);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // A successful verify signs the user in via signInWithCustomToken and
    // Login.jsx navigates to "/" immediately — no dead-end sign-in page. A
    // brand-new account has no profile yet, so ProfileSetupRedirect
    // (components/ProfileSetupRedirect.jsx) — which fires from '/' or
    // '/signin' once the signed-in account's profile status is 'ready' —
    // takes it straight to /profile next. Waiting for "/" first would race
    // that redirect: it can fire fast enough that the URL never settles on
    // "/" for a poll to observe, which would time out even though sign-in
    // (and the redirect) both succeeded. Wait directly for the durable
    // destination instead — landing there is also the real proof the
    // sign-in stuck, stronger than re-rendering the sign-in form's own "you
    // are signed in" copy would be.
    await page.waitForURL(/\/profile$/);
    await expect(page.getByRole('heading', { name: /complete your profile/i })).toBeVisible();

    // The session also persists across a fresh page load: reload the
    // profile page itself (rather than /signin, which ProfileSetupRedirect
    // would immediately bounce away from again) and confirm Firebase Auth's
    // onAuthStateChanged still reports this account without any further
    // form interaction.
    await page.reload();
    await expect(page.getByRole('heading', { name: /complete your profile/i })).toBeVisible();
  });
});
