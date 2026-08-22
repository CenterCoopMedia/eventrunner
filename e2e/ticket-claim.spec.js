// Ticket claim -> approved -> bookmark (issue #38 done-when d).
//
// The ticket itself is seeded directly into `tickets/{externalId}` with
// `provider: 'manual'` — that collection IS the manual provider's store
// (functions/src/ticketing/providers/manual.cjs module doc: "There is no
// external ticketing platform behind this adapter"), the emulator
// equivalent of an admin's CSV import. Everything downstream — claiming it,
// the account moving to `approved` (config/features.autoApproveTicketHolders,
// turned on by e2e/fixtures/answers.json), and bookmarking a session — runs
// through the real pages a signed-in attendee uses.
import { test, expect } from '@playwright/test';
import { adminDb, emulatorLogSize, waitForOtpCode } from './helpers.mjs';

test.describe.serial('Ticket claim -> approved -> bookmark', () => {
  const stamp = Date.now();
  const email = `ticket-e2e-${stamp}@example.test`;
  const orderId = `E2E-ORDER-${stamp}`;
  const externalId = `e2e-ticket-${stamp}`;
  const sessionId = 'session-welcome';

  test.beforeAll(async () => {
    await adminDb().collection('tickets').doc(externalId).set({
      provider: 'manual',
      orderId,
      email,
      firstName: 'E2E',
      lastName: `Ticket ${stamp}`,
      ticketClass: 'General',
      quantity: 1,
      status: 'valid',
      claimedByUid: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test('an attendee claims a manual ticket, is approved, and bookmarks a session', async ({ page }) => {
    // Sign in as the ticket-holder through the real OTP flow — the account
    // this order's email address has to match to claim it.
    const since = emulatorLogSize();
    await page.goto('/signin');
    const emailInput = page.locator('#signin-email');
    await emailInput.waitFor({ state: 'visible' });
    await emailInput.fill(email);
    await page.getByRole('button', { name: /email me a code/i }).click();
    const codeInput = page.locator('#signin-code');
    await codeInput.waitFor({ state: 'visible' });
    const code = await waitForOtpCode(since, email, 30000);
    expect(code, 'the OTP code was captured from the emulator log').toBeTruthy();
    await codeInput.fill(code);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/$/);

    // Claim the ticket by order number (issue #33): every failure mode
    // answers the same 404 (module doc, apps/web/src/pages/TicketClaim.jsx),
    // so the one observable success path is the order being accepted.
    await page.goto('/ticket/claim');
    const orderInput = page.locator('#order-number');
    await orderInput.waitFor({ state: 'visible' });
    await orderInput.fill(orderId);
    await page.getByRole('button', { name: /^claim ticket$/i }).click();
    await expect(page.getByRole('heading', { name: /ticket claimed/i })).toBeVisible();

    // Server-side: the ticket is claimed, and — with autoApproveTicketHolders
    // seeded on — the account went straight to approved (functions/src/
    // ticketing/registration.cjs applyTicketClaimToUser), never through an
    // admin approval it never had.
    await expect
      .poll(async () => (await adminDb().collection('tickets').doc(externalId).get()).data()?.claimedByUid,
        { timeout: 15000 })
      .toBeTruthy();
    const uid = (await adminDb().collection('tickets').doc(externalId).get()).data().claimedByUid;
    await expect
      .poll(async () => (await adminDb().collection('users').doc(uid).get()).data()?.registrationStatus,
        { timeout: 15000 })
      .toBe('approved');

    // Bookmark a session — gated on config/features.sessionBookmarks (on)
    // and on an approved attendee (components/SessionCard.jsx BookmarkPill),
    // which is exactly the state this attendee just reached.
    await page.goto(`/schedule/${sessionId}`);
    const bookmarkButton = page.getByRole('button', { name: /^bookmark$/i });
    await bookmarkButton.waitFor({ state: 'visible' });
    await bookmarkButton.click();
    await expect(page.getByRole('button', { name: /^bookmarked$/i })).toBeVisible();
    // The click above only confirms the OPTIMISTIC UI update
    // (components/SessionCard.jsx BookmarkPill); wait for the server write
    // itself (users/{uid}/bookmarks/{sessionId}) before relying on it from
    // another page below.
    await expect
      .poll(async () => (await adminDb().collection(`users/${uid}/bookmarks`).doc(sessionId).get()).exists,
        { timeout: 15000 })
      .toBe(true);

    // It shows up under "my schedule" too — the other surface that reads
    // the same bookmark.
    await page.goto('/schedule/mine');
    await expect(page.getByText(/welcome and orientation/i)).toBeVisible();
  });
});
