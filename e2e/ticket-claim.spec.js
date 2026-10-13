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
import { adminAuth, adminDb, mailFileSize, waitForOtpCode } from './helpers.mjs';

test.describe.serial('Ticket claim -> approved -> bookmark', () => {
  const stamp = Date.now();
  const email = `ticket-e2e-${stamp}@example.test`;
  const uid = `ticket-e2e-user-${stamp}`;
  const orderId = `E2E-ORDER-${stamp}`;
  const externalId = `e2e-ticket-${stamp}`;
  const sessionId = 'session-keynote';

  test.beforeAll(async () => {
    // An admin-issued account can exist before its address is verified.
    // The real OTP exchange must verify this account, not replace it.
    await adminAuth().createUser({ uid, email, emailVerified: false });
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

  test('an existing unverified attendee completes OTP, claims a manual ticket, and bookmarks a session', async ({ page }) => {
    const initialAccount = await adminAuth().getUserByEmail(email);
    expect(initialAccount.uid).toBe(uid);
    expect(initialAccount.emailVerified).toBe(false);

    // A confirmation deep link must survive real OTP authentication in place.
    // Authentication and profile readiness must never submit the claim.
    const claimRequests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/ticketingVerifyOrder')) claimRequests.push(request);
    });
    const claimPath = `/ticket/claim?order=${encodeURIComponent(orderId)}`;
    const since = mailFileSize();
    await page.goto(claimPath);
    const emailInput = page.locator('#signin-email');
    await emailInput.waitFor({ state: 'visible' });
    await emailInput.fill(email);
    await page.getByRole('button', { name: /email me a code/i }).click();
    const codeInput = page.locator('#signin-code');
    await codeInput.waitFor({ state: 'visible' });
    const code = await waitForOtpCode(since, email, 30000);
    expect(code, 'the OTP code was captured from the mail file').toBeTruthy();
    await codeInput.fill(code);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect.poll(async () => {
      const verifiedAccount = await adminAuth().getUserByEmail(email);
      return { uid: verifiedAccount.uid, emailVerified: verifiedAccount.emailVerified };
    }, { timeout: 15000 }).toEqual({ uid, emailVerified: true });
    const orderInput = page.locator('#order-number');
    await expect(orderInput).toBeVisible({ timeout: 15000 });

    // The claim endpoint requires users/{uid} to already exist —
    // applyTicketClaimToUser (functions/src/ticketing/registration.cjs)
    // no-ops on a missing account doc, silently burning the ticket's claim
    // without ever reaching "approved". That doc is seeded by the
    // onUserCreated auth trigger (functions/src/users/lifecycle.cjs) after
    // account creation. The claim page gates on ProfileContext readiness;
    // also prove that record exists before the explicit claim. Do not use
    // ensureUser here: a helper-created verified account would mask the
    // existing-account OTP regression this journey must prove.
    await expect
      .poll(async () => (await adminDb().collection('users').doc(uid).get()).exists, { timeout: 15000 })
      .toBe(true);

    // Claim the ticket by order number (issue #33): every failure mode
    // answers the same 404 (module doc, apps/web/src/pages/TicketClaim.jsx),
    // so the one observable success path is the order being accepted.
    await expect(orderInput).toHaveValue(orderId);
    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === claimPath);
    expect(claimRequests).toHaveLength(0);
    expect((await adminDb().collection('tickets').doc(externalId).get()).data()?.claimedByUid).toBeNull();
    await page.getByRole('button', { name: /^claim ticket$/i }).click();
    await expect(page.getByRole('heading', { name: /ticket claimed/i })).toBeVisible();
    expect(claimRequests).toHaveLength(1);

    // Server-side: the ticket is claimed, and — with autoApproveTicketHolders
    // seeded on — the account went straight to approved (functions/src/
    // ticketing/registration.cjs applyTicketClaimToUser), never through an
    // admin approval it never had.
    await expect
      .poll(async () => (await adminDb().collection('tickets').doc(externalId).get()).data()?.claimedByUid,
        { timeout: 15000 })
      .toBe(uid);
    await expect
      .poll(async () => (await adminDb().collection('users').doc(uid).get()).data()?.registrationStatus,
        { timeout: 15000 })
      .toBe('approved');

    // Bookmark a session — gated on config/features.sessionBookmarks (on)
    // and on an approved attendee (components/session/BookmarkAction.jsx),
    // which is exactly the state this attendee just reached.
    await page.goto(`/schedule/${sessionId}`);
    const bookmarkButton = page.getByRole('button', { name: /^bookmark$/i });
    await bookmarkButton.waitFor({ state: 'visible' });
    await bookmarkButton.click();
    await expect(page.getByRole('button', { name: /^bookmarked$/i })).toBeVisible();
    // The click above only confirms the OPTIMISTIC UI update
    // (components/session/BookmarkAction.jsx); wait for the server write
    // itself (users/{uid}/bookmarks/{sessionId}) before relying on it from
    // another page below.
    await expect
      .poll(async () => (await adminDb().collection(`users/${uid}/bookmarks`).doc(sessionId).get()).exists,
        { timeout: 15000 })
      .toBe(true);

    // It shows up under "my schedule" too — the other surface that reads
    // the same bookmark.
    await page.goto('/schedule/mine');
    await expect(page.getByText(/NC’s AI Crossroads/)).toBeVisible();
  });
});
