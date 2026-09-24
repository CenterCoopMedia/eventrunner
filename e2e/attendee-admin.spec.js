// Attendee export (issue 184) and attendee administration (issue 185),
// driven through the real surfaces.
//
// A staff account — the tier that runs Attendees — is granted on
// config/bootstrap for this file and signs in once, through the real Login
// page. It exports from the Attendees title band, records past attendance
// in a row's record panel, and deletes the account from the same panel.
// The evidence is what a person sees or holds: the file the browser saves,
// read back from disk; the public directory, open in a second, signed-out
// browser, losing the deleted name; and the stores behind them, read with
// the Admin SDK.
//
// The attendee is seeded the way production creates one: an Auth account
// (the onUserCreated trigger writes users/{uid}), then the profile and the
// registration fields set with the Admin SDK, as the profile form and the
// approval endpoint would. A stamp keeps the name unique per run.
//
// config/bootstrap and config/features are restored when the file is done,
// because later specs sign in as the seeded operator and read the flags.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { getStorage } from 'firebase-admin/storage';
import {
  PROJECT_ID, adminApp, adminAuth, adminDb, ensureUser, mailFileSize, waitForOtpCode,
} from './helpers.mjs';

const HEADER = [
  'Name', 'Email', 'Organization', 'Role', 'Registration status', 'Badges',
  'Past attendance', 'Social handles', 'Profile visibility',
];

const STAFF_EMAIL = 'e2e-attendee-staff@example.test';

/**
 * RFC 4180 reader: quoted fields, doubled quotes, CRLF records. Checks the
 * byte-order mark and that every cell is quoted, as the export promises.
 */
function parseCsv(text) {
  expect(text.startsWith('\uFEFF'), 'the file starts with a byte-order mark').toBe(true);
  const body = text.slice(1);
  const rows = [];
  let row = [];
  let i = 0;
  while (i < body.length) {
    expect(body[i], `every cell is quoted (offset ${i})`).toBe('"');
    i += 1;
    let cell = '';
    for (;;) {
      if (body[i] === '"' && body[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (body[i] === '"') { i += 1; break; }
      cell += body[i];
      i += 1;
    }
    row.push(cell);
    if (body[i] === ',') { i += 1; continue; }
    expect(body.slice(i, i + 2), 'records end with CRLF').toBe('\r\n');
    i += 2;
    rows.push(row);
    row = [];
  }
  return rows;
}

async function signIn(page, email) {
  const since = mailFileSize();
  await page.goto('/signin');
  await page.locator('#signin-email').fill(email);
  await page.getByRole('button', { name: /email me a code/i }).click();
  await expect(page.locator('#signin-code')).toBeVisible();
  await page.locator('#signin-code').fill(await waitForOtpCode(since, email, 30_000));
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => url.pathname !== '/signin');
}

function bucket() {
  return getStorage(adminApp()).bucket(process.env.EVENT_STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`);
}

test.describe.serial('attendee export and administration', () => {
  const stamp = Date.now();
  const email = `attendee-admin-${stamp}@example.test`;
  const name = `Rae Okonkwo ${stamp}`;
  const sessionId = `e2e-delete-session-${stamp}`;
  const ticketId = `e2e-delete-ticket-${stamp}`;
  const photoPath = () => `profile-photos/${uid}/photo.jpg`;
  let uid;
  let seededBootstrap;
  let seededFeatures;
  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    const config = adminDb().collection('config');
    seededBootstrap = (await config.doc('bootstrap').get()).data();
    seededFeatures = (await config.doc('features').get()).data();
    await config.doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
    // The public directory is the surface a delete must clear.
    await config.doc('features').set({ attendeeDirectory: true, publicAttendeeProfiles: true }, { merge: true });

    uid = await ensureUser(email);
    const ref = adminDb().collection('users').doc(uid);
    await expect.poll(async () => (await ref.get()).exists, { timeout: 20_000 }).toBe(true);
    await ref.set({
      displayName: name,
      pronouns: 'PRIVATE-pronouns',
      bio: 'PRIVATE-bio',
      organization: '=HYPERLINK("http://example.test")',
      jobTitle: 'Data editor',
      socialHandles: { mastodon: '@rae@example.social', bluesky: '@rae.example.test' },
      badges: [],
      profileVisibility: 'public',
      registrationStatus: 'approved',
      approvalSource: 'admin',
    }, { merge: true });

    context = await browser.newContext();
    page = await context.newPage();
    await signIn(page, STAFF_EMAIL);
  });

  test.afterAll(async () => {
    await context?.close();
    const config = adminDb().collection('config');
    if (seededBootstrap) await config.doc('bootstrap').set(seededBootstrap);
    if (seededFeatures) await config.doc('features').set(seededFeatures);
  });

  test('a staff organizer records past attendance; it reaches the account, never the directory', async () => {
    await page.goto('/admin/attendees');
    await page.getByLabel('Search').fill(name);
    const toggle = page.getByRole('button', { name: 'Edit record' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const panel = page.getByRole('region', { name: `Record for ${name}` });
    await panel.getByLabel('Past attendance').fill('2024\n 2025 \n');
    await panel.getByRole('button', { name: 'Save record' }).click();
    await expect(panel.getByRole('status')).toHaveText('Past attendance saved.');

    const ref = adminDb().collection('users').doc(uid);
    await expect.poll(async () => (await ref.get()).data()?.pastAttendance).toEqual(['2024', '2025']);
    // The row face shows it; the public projection never carries it.
    await expect(page.getByText('Past attendance: 2024; 2025')).toBeVisible();
    const projection = adminDb().collection('users_public').doc(uid);
    await expect.poll(async () => (await projection.get()).data()?.displayName).toBe(name);
    expect(Object.hasOwn((await projection.get()).data(), 'pastAttendance')).toBe(false);

    const logs = await adminDb().collection('admin_logs').where('docPath', '==', `users/${uid}`).get();
    expect(logs.docs.map((doc) => doc.data())).toContainEqual(expect.objectContaining({
      action: 'updateAttendee', email: STAFF_EMAIL,
    }));
  });

  test('the export carries exactly the approved fields, a formula escaped, and an audit row', async () => {
    const exportsBefore = (await adminDb().collection('admin_logs').where('action', '==', 'exportAttendees').get()).size;

    await page.goto('/admin/attendees');
    await page.getByLabel('Search').fill(name);
    const button = page.getByRole('button', { name: 'Export 1 attendee', exact: true });
    await expect(button).toBeEnabled();

    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);

    expect(download.suggestedFilename()).toMatch(/^attendees-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = fs.readFileSync(await download.path(), 'utf8');
    expect(parseCsv(text)).toEqual([
      HEADER,
      [
        name,
        email,
        // The formula-shaped organization is text in the file.
        `'=HYPERLINK("http://example.test")`,
        'Data editor',
        'approved',
        '',
        '2024; 2025',
        'bluesky: @rae.example.test; mastodon: @rae@example.social',
        'public',
      ],
    ]);
    for (const secret of ['PRIVATE', uid]) expect(text).not.toContain(secret);

    await expect(page.getByRole('status').filter({ hasText: 'Exported 1 attendee to' }))
      .toHaveText(`Exported 1 attendee to ${download.suggestedFilename()}. The export is in the admin log.`);

    // The server wrote the audit row before it sent the file.
    const logs = await adminDb().collection('admin_logs').where('action', '==', 'exportAttendees').get();
    expect(logs.size).toBe(exportsBefore + 1);
    const row = logs.docs.map((doc) => doc.data()).find((data) => data.email === STAFF_EMAIL);
    expect(row).toMatchObject({
      action: 'exportAttendees',
      docPath: 'users',
      email: STAFF_EMAIL,
      details: { rowCount: 1, filter: { status: 'all', searched: true } },
    });
    // The search text named the person; the row does not.
    expect(JSON.stringify(row)).not.toContain('Okonkwo');
  });

  test('a deleted account disappears from the directory, and every per-account store is cleared', async ({ browser }) => {
    // Something in every per-account store.
    const db = adminDb();
    await db.collection('sessionBookmarks').doc(sessionId).set({ count: 1, updatedAt: new Date() });
    await db.collection(`users/${uid}/bookmarks`).doc(sessionId).set({ bookmarkedAt: new Date() });
    await db.collection(`users/${uid}/sessionNotes`).doc(sessionId).set({ text: 'Ask about the dataset.' });
    await db.collection('tickets').doc(ticketId).set({
      provider: 'manual', orderId: `E2E-ORDER-${stamp}`, email, status: 'valid',
      claimedByUid: uid, claimedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });
    await bucket().file(photoPath()).save(Buffer.from('not really a photo'), { contentType: 'image/jpeg' });
    // The bookmark trigger writes the schedule share.
    await expect.poll(async () => (await db.collection('schedule_shares').doc(uid).get()).exists, { timeout: 20_000 })
      .toBe(true);

    // A signed-out visitor sees the public profile in the directory.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto('/attendees');
    await expect(visitor.getByText(name, { exact: true })).toBeVisible();

    // The staff organizer deletes the account from its record.
    await page.goto('/admin/attendees');
    await page.getByLabel('Search').fill(name);
    await page.getByRole('button', { name: 'Edit record' }).click();
    const panel = page.getByRole('region', { name: `Record for ${name}` });
    await panel.getByRole('button', { name: 'Delete account' }).click();
    await expect(panel.getByRole('heading', { name: `Delete the account for ${name}` })).toBeVisible();
    await panel.getByRole('button', { name: 'Delete this account' }).click();

    const done = page.getByRole('status').filter({ hasText: 'Deleted the account for' });
    await expect(done).toHaveText(`Deleted the account for ${name}.`);
    await expect(done).toBeFocused();

    // Gone from the open directory, live and after a reload.
    await expect(visitor.getByText(name, { exact: true })).toHaveCount(0);
    await visitor.reload();
    await expect(visitor.getByRole('heading', { level: 1, name: 'Attendees' })).toBeVisible();
    await expect(visitor.getByText(name, { exact: true })).toHaveCount(0);
    await visitorContext.close();

    // Every store the delete names is cleared, and the triggers put nothing back.
    expect((await db.collection('users').doc(uid).get()).exists).toBe(false);
    expect((await db.collection('users_public').doc(uid).get()).exists).toBe(false);
    expect((await db.collection('schedule_shares').doc(uid).get()).exists).toBe(false);
    expect((await db.collection(`users/${uid}/bookmarks`).get()).size).toBe(0);
    expect((await db.collection(`users/${uid}/sessionNotes`).get()).size).toBe(0);
    expect((await db.collection('sessionBookmarks').doc(sessionId).get()).data().count).toBe(0);
    expect((await db.collection('tickets').doc(ticketId).get()).data()).toMatchObject({
      claimedByUid: null, claimedAt: null, email,
    });
    const [photoExists] = await bucket().file(photoPath()).exists();
    expect(photoExists).toBe(false);
    await expect(adminAuth().getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    await expect.poll(async () => (await db.collection('users_public').doc(uid).get()).exists).toBe(false);

    const logs = await db.collection('admin_logs').where('docPath', '==', `users/${uid}`).get();
    expect(logs.docs.map((doc) => doc.data())).toContainEqual(expect.objectContaining({
      action: 'deleteAttendee', email: STAFF_EMAIL,
    }));
  });
});
