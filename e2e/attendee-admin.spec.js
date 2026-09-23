// Attendee export (issue 184), driven through the real surface.
//
// The seeded operator signs in through the real Login page, opens
// Attendees, narrows the list to one seeded account, and presses the title
// band's export button. The evidence is the file the browser saves: its
// header and its row, read back from disk, plus the admin_logs row the
// server wrote before it sent the file.
//
// The attendee is seeded the way production creates one: an Auth account
// (the onUserCreated trigger writes users/{uid}), then the profile and the
// registration fields set with the Admin SDK, as the profile form and the
// approval endpoint would. A stamp keeps the name unique per run.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, ensureUser, mailFileSize, waitForOtpCode } from './helpers.mjs';

const HEADER = [
  'Name', 'Email', 'Organization', 'Role', 'Registration status', 'Badges',
  'Past attendance', 'Social handles', 'Profile visibility',
];

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

test.describe.serial('attendee export and administration', () => {
  const stamp = Date.now();
  const email = `attendee-admin-${stamp}@example.test`;
  const name = `Rae Okonkwo ${stamp}`;
  let uid;

  test.beforeAll(async () => {
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
      pastAttendance: ['2025'],
    }, { merge: true });
  });

  test('an organizer exports the rows on screen: exactly the approved fields, a formula escaped, and an audit row', async ({ page }) => {
    const exportsBefore = (await adminDb().collection('admin_logs').where('action', '==', 'exportAttendees').get()).size;

    await signIn(page, ADMIN_EMAIL);
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
        '2025',
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
    const row = logs.docs
      .map((doc) => doc.data())
      .find((data) => data.email === ADMIN_EMAIL && data.details?.rowCount === 1 && data.details?.filter?.searched === true);
    expect(row).toMatchObject({
      action: 'exportAttendees',
      docPath: 'users',
      email: ADMIN_EMAIL,
      details: { rowCount: 1, filter: { status: 'all', searched: true } },
    });
    // The search text named the person; the row does not.
    expect(JSON.stringify(row)).not.toContain('Okonkwo');
  });
});
