// Speaker invite -> accept -> wizard (issue #38 done-when c; issue #21/#22).
//
// The admin half — creating the speaker record and sending the invite — is
// driven at the HTTP layer, the same way scripts/dev/invite-smoke.mjs
// drives the whole pipeline: it is not what this spec is testing, and
// nothing about it is browser-observable. What IS the point of the
// exercise, ported into Playwright from invite-smoke.mjs's own comment on
// this: the invite token is stored only as a SHA-256 digest, so the ONLY
// way to obtain it is to read the mail — scraped from the captured
// emulator log — exactly as an invited speaker does. From there the whole
// accept journey (sign in with an emailed code, accept, land on the
// profile wizard) runs through the real /speaker/accept page.
import { test, expect } from '@playwright/test';
import {
  adminIdToken, adminDb, callFunction, mailFileSize, waitForInviteToken, waitForOtpCode,
} from './helpers.mjs';

test.describe.serial('Speaker invite -> accept -> wizard', () => {
  const stamp = Date.now();
  const speakerId = `e2e-speaker-${stamp}`;
  const speakerEmail = `speaker-e2e-${stamp}@example.test`;
  const speakerName = `E2E Speaker ${stamp}`;

  test('an invited speaker signs in and accepts, and lands on the profile wizard', async ({ page }) => {
    const idToken = await adminIdToken();

    const since = mailFileSize();
    const created = await callFunction('createSpeaker', {
      speakerId,
      speaker: { firstName: 'E2E', lastName: `Speaker ${stamp}`, email: speakerEmail, status: 'draft' },
    }, idToken);
    expect(created.status, `createSpeaker answered 200 (${JSON.stringify(created.body)})`).toBe(200);

    const sent = await callFunction('sendSpeakerInvite', { speakerId }, idToken);
    expect(sent.status, `sendSpeakerInvite answered 200 (${JSON.stringify(sent.body)})`).toBe(200);
    expect(sent.body?.status).toBe('invited');

    const token = await waitForInviteToken(since, speakerEmail, 30000);
    expect(token, 'the invitation email was captured, carrying the accept token').toBeTruthy();

    // The link validates and names the invited speaker before anybody signs in.
    await page.goto(`/speaker/accept?token=${token}`);
    await expect(page.getByText(new RegExp(speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible();

    // Sign in at the invited address, through the real emailed-code form —
    // the load-bearing property invite-smoke.mjs's own comment names: the
    // invited address is an authorization boundary, and this is where an
    // invite-first speaker's VERIFIED account at that address comes from.
    const otpSince = mailFileSize();
    const emailInput = page.locator('#signin-email');
    await emailInput.waitFor({ state: 'visible' });
    await emailInput.fill(speakerEmail);
    await page.getByRole('button', { name: /email me a code/i }).click();

    const codeInput = page.locator('#signin-code');
    await codeInput.waitFor({ state: 'visible' });
    const code = await waitForOtpCode(otpSince, speakerEmail, 30000);
    expect(code, 'the sign-in code was captured from the mail file').toBeTruthy();
    await codeInput.fill(code);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Signing in does not accept anything on its own — the accept click is
    // the consent, deliberately separate (SpeakerAccept.jsx module doc).
    await expect(page.getByText(new RegExp(`signed in as ${speakerEmail}`))).toBeVisible();
    await page.getByRole('button', { name: /accept the invitation/i }).click();

    await expect(page.getByRole('heading', { name: /you are confirmed/i })).toBeVisible();
    const wizardLink = page.getByRole('link', { name: /write your speaker profile/i });
    await expect(wizardLink).toHaveAttribute('href', '/speaker/profile');
    await wizardLink.click();
    await expect(page).toHaveURL(/\/speaker\/profile$/);

    // users.speakerId <-> speakers.uid are linked, and the token is burned
    // (functions/src/speakers/invites.cjs) — the server-side half of the
    // done-when, checked directly against the emulator the way
    // invite-smoke.mjs already does.
    const speakerDoc = (await adminDb().collection('speakers').doc(speakerId).get()).data();
    expect(speakerDoc.status).toBe('accepted');
    expect(speakerDoc.inviteToken).toBeNull();
    expect(speakerDoc.uid).toBeTruthy();
    const userDoc = (await adminDb().collection('users').doc(speakerDoc.uid).get()).data();
    expect(userDoc.speakerId).toBe(speakerId);
  });
});
