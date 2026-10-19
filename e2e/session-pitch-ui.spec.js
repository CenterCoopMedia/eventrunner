// Real emulator and browser contracts. Synthetic records only; navigate
// through accessible element references, with Chromium's sandbox enabled.
/* global window, document */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { adminDb, adminIdToken, callFunction, ensureUser, idTokenFor, signIn, mailFileSize, waitForOtpCode, waitForTaggedMail, taggedMailSince } from './helpers.mjs';

const email = 'pitch-ui@example.test';
const fixture = { title: 'Reporting together', description: 'A practical workshop on shared local reporting. Learn to plan a project, share evidence, and reach new readers.', organization: 'Example newsroom', format: 'Workshop' };
const evidence = process.env.PITCH_EVIDENCE_DIR;
let originalCall;
test.beforeAll(async () => {
  const ref = adminDb().collection('config').doc('pitch_call');
  originalCall = await ref.get();
  await ref.set({ enabled: true, closesAt: '2030-11-30T23:59:59Z' });
});
test.afterAll(async () => {
  const ref = adminDb().collection('config').doc('pitch_call');
  if (originalCall.exists) await ref.set(originalCall.data()); else await ref.delete();
});

async function shot(page, name) {
  if (!evidence) return;
  await fs.mkdir(evidence, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(evidence, name + '.png'), animations: 'disabled' });
}

test('pitch entries survive sign-in, keyboard validation, a lost response, and reload', async ({ page }) => {
  page.on('pageerror', (err) => console.error('Browser error:', err.message));
  const db = adminDb();
  await ensureUser(email);
  await page.goto('/pitch');
  await expect(page.getByRole('heading', { name: 'Pitch a session' })).toBeVisible();
  await expect(page.getByText('Submissions are open', { exact: true })).toBeVisible();
  await page.getByLabel('Session title', { exact: true }).fill(fixture.title);
  await page.getByLabel('Session description', { exact: true }).fill(fixture.description);
  await page.getByLabel('Organization (optional)').fill(fixture.organization);
  await page.getByLabel('Format (optional)').fill(fixture.format);
  await page.getByRole('checkbox', { name: /I agree that organizers/ }).check();
  const since = mailFileSize();
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await page.getByLabel('Six-digit code').fill(await waitForOtpCode(since, email));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit pitch' })).toBeEnabled();
  await expect(page.getByLabel('Session title', { exact: true })).toHaveValue(fixture.title);
  await page.getByLabel('Session title', { exact: true }).fill('');
  await page.getByLabel('Session description', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Submit pitch' }).click();
  await expect(page.getByLabel('Session title', { exact: true })).toBeFocused();
  await page.getByLabel('Session title', { exact: true }).press('R');
  await expect(page.getByLabel('Session title', { exact: true })).toBeFocused();
  await page.getByLabel('Session title', { exact: true }).fill(fixture.title);
  await page.getByLabel('Session description', { exact: true }).fill(fixture.description);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Submit pitch' })).toBeEnabled();
  await expect(page.getByLabel('Session description', { exact: true })).toHaveValue(fixture.description);
  for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    await shot(page, 'form-after-' + name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  // One committed request loses its answer. The next request must replay it.
  const receiptSince = mailFileSize();
  await page.route('**/submitSessionPitch', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.abort('failed');
    await page.unroute('**/submitSessionPitch');
  });
  await page.getByRole('button', { name: 'Submit pitch' }).click();
  await expect(page.getByText(/Your entries are still here. Retry/)).toBeVisible();
  await expect(page.getByLabel('Session title', { exact: true })).toHaveValue(fixture.title);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Submit pitch' })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit pitch' }).click();
  await expect(page.getByRole('heading', { name: 'Your pitch is saved' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your pitch is saved' }).locator('..')).toBeFocused();
  const submitted = await db.collection('session_pitches').where('email', '==', email).get();
  expect(submitted.size).toBe(1);
  expect(submitted.docs[0].data()).toMatchObject({ ...fixture, status: 'new', consent: { version: 'session-pitch-review-v1' } });
  // Issue #324: one receipt for the stored pitch, although the form sent it twice.
  const receipt = await waitForTaggedMail(receiptSince, email, 'pitch.receipt');
  expect(receipt.text).toContain(`We received “${fixture.title}”.`);
  expect(taggedMailSince(receiptSince, email, 'pitch.receipt')).toHaveLength(1);
  expect(submitted.docs[0].data().notices.receipt).toMatchObject({ state: 'sent', attempt: 1 });
  const token = await idTokenFor(await ensureUser(email));
  expect((await callFunction('convertSessionPitch', {}, token)).status).toBe(403);
  expect((await callFunction('importSessionPitches', {}, token)).status).toBe(403);
  await page.getByRole('button', { name: 'Pitch another session' }).click();
  await expect(page.getByLabel('Session title', { exact: true })).toBeFocused();
  await db.collection('session_pitches').doc(submitted.docs[0].id).delete();
});

test('staff reviews conflicts, exports without private notes, and converts accepted pitches once', async ({ page }) => {
  const db = adminDb();
  const id = 'pitch-ui-review';
  const ref = db.collection('session_pitches').doc(id);
  await ref.set({ ...fixture, email, uid: null, status: 'new', reviewRevision: 0, privateNotes: null, consent: { version: 'source-form' } });
  try {
    await signIn(page, 'e2e-admin@example.test');
    await page.goto('/admin/pitches');
    await expect(page.getByRole('heading', { name: 'Session pitches', exact: true })).toBeVisible();
    if (await page.getByRole('button', { name: 'End tour', exact: true }).isVisible()) await page.getByRole('button', { name: 'End tour', exact: true }).click();
    await page.getByRole('button', { name: fixture.title, exact: true }).click();
    for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await shot(page, 'queue-after-' + name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    const longRef = db.collection('session_pitches').doc('pitch-ui-long-title');
    await longRef.set({ ...fixture, title: 'X'.repeat(160), email, status: 'new', reviewRevision: 0 });
    await page.getByRole('button', { name: 'X'.repeat(160), exact: true }).click();
    await expect(page.getByRole('heading', { name: 'X'.repeat(160), exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await longRef.delete();
    await page.getByRole('button', { name: fixture.title, exact: true }).click();
    await page.getByLabel('Private review notes').fill('PRIVATE-STAFF-NOTE');
    await ref.update({ reviewRevision: 1, privateNotes: 'Other reviewer note' });
    await expect(page.getByText(/This pitch changed. Your unsaved notes/)).toBeVisible();
    await expect(page.getByLabel('Private review notes')).toHaveValue('PRIVATE-STAFF-NOTE');
    await page.getByRole('button', { name: 'Load current review' }).click();
    await expect(page.getByLabel('Private review notes')).toHaveValue('Other reviewer note');
    await page.getByLabel('Private review notes').fill('PRIVATE-STAFF-NOTE');
    await page.getByLabel('Decision', { exact: true }).selectOption('accepted');
    const decisionSince = mailFileSize();
    await page.getByRole('button', { name: 'Save review decision' }).click();
    await expect(page.getByText('Review saved. No email was sent.')).toBeVisible();
    // Issue #324: a decision sends nothing until staff preview and confirm its email.
    await expect(page.getByText('No email was sent for this pitch.')).toBeVisible();
    expect(taggedMailSince(decisionSince, email, 'pitch.accepted')).toHaveLength(0);
    await page.getByText('Prepare the acceptance email', { exact: true }).click();
    await page.getByLabel('Note to the submitter (optional)').fill('Plan for 45 minutes.');
    await page.getByRole('button', { name: 'Preview the acceptance email' }).click();
    const preview = page.getByRole('region', { name: 'Preview of the acceptance email' });
    await expect(preview).toBeFocused();
    await expect(preview).toContainText('Plan for 45 minutes.');
    await expect(preview).not.toContainText('PRIVATE-STAFF-NOTE');
    // The fixture has no Firebase identity, like an imported pitch.
    await expect(preview).toContainText('This address came from an imported CSV. Nobody verified it.');
    await expect(page.getByRole('button', { name: 'Send the acceptance email' })).toBeDisabled();
    await page.getByRole('checkbox', { name: `I reviewed this email. Send it to ${email}.` }).check();
    await page.getByRole('button', { name: 'Send the acceptance email' }).click();
    await expect(page.getByText(`Acceptance email sent to ${email}.`)).toBeVisible();
    await expect(page.getByText('Sent', { exact: true })).toBeVisible();
    const accepted = await waitForTaggedMail(decisionSince, email, 'pitch.accepted');
    expect(accepted.text).toContain('Plan for 45 minutes.');
    expect(`${accepted.subject} ${accepted.text} ${accepted.html}`).not.toContain('PRIVATE-STAFF-NOTE');
    await expect(page.getByText('Prepare the acceptance email', { exact: true })).toHaveCount(0);
    await page.getByLabel('Filter by decision').selectOption('accepted');
    await expect(page.getByRole('button', { name: fixture.title, exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export filtered queue' }).click();
    const file = await download;
    const text = await fs.readFile(await file.path(), 'utf8');
    expect(text).toContain(fixture.title);
    expect(text).not.toMatch(/PRIVATE-STAFF-NOTE|privateNotes|uid|reviewedBy/);
    await page.getByText('Create session and speaker drafts', { exact: true }).click();
    await page.getByLabel('Speaker first name').fill('Example');
    await page.getByLabel('Speaker last name').fill('Presenter');
    const dayId = (await db.collection('config').doc('event').get()).data().days[0].id;
    await page.getByLabel('Event day').selectOption(dayId);
    await page.getByLabel('Start time', { exact: true }).fill('10:00');
    await page.getByLabel('End time', { exact: true }).fill('11:00');
    await page.getByRole('checkbox', { name: /I reviewed the proposal/ }).check();
    await page.getByRole('button', { name: 'Create reviewed drafts' }).click();
    await expect(page.getByRole('link', { name: 'Review session draft' })).toBeVisible();
    const converted = (await ref.get()).data().conversion;
    expect((await db.collection('cmsSchedule').doc(converted.sessionId).get()).exists).toBe(false);
    expect((await db.collection('cmsSchedule_drafts').doc(converted.sessionId).get()).data()).toMatchObject({ visible: false, status: 'dirty', speakerIds: [converted.speakerId] });
    expect((await db.collection('speakers').doc(converted.speakerId).get()).data()).toMatchObject({ status: 'draft', uid: null, inviteToken: null });
    expect((await db.collection('speakers_public').doc(converted.speakerId).get()).exists).toBe(false);
    await expect(page.getByRole('button', { name: 'Save review decision' })).toBeEnabled();
    await page.getByLabel('Private review notes').fill('Post-conversion review');
    await page.getByRole('button', { name: 'Save review decision' }).click();
    await expect(page.getByText('Review saved. No email was sent.')).toBeVisible();
    expect((await ref.get()).data()).toMatchObject({ privateNotes: 'Post-conversion review', reviewRevision: 4 });
    await ref.update({ reviewRevision: 5, privateNotes: 'Another reviewer after conversion' });
    await expect(page.getByText(/This pitch changed. Your unsaved notes/)).toBeVisible();
    await expect(page.getByLabel('Private review notes')).toHaveValue('Post-conversion review');
    const token = await adminIdToken();
    const retry = await callFunction('convertSessionPitch', { id, expectedRevision: 2, firstName: 'Example', lastName: 'Presenter', dayId, startTime: '10:00', endTime: '11:00' }, token);
    expect(retry).toMatchObject({ status: 200, body: { ...converted, replayed: true } });
    const denied = await callFunction('convertSessionPitch', { id: 'missing', expectedRevision: 0, firstName: 'Example', lastName: 'Presenter', dayId, startTime: '10:00', endTime: '11:00' }, token);
    expect(denied.status).toBe(404);
  } finally {
    await Promise.all(['session_pitches/' + id, 'session_pitches/pitch-ui-long-title', 'cmsSchedule_drafts/pitch-' + id, 'speakers/pitch-' + id, 'speaker_slugs/pitch-' + id].map((name) => db.doc(name).delete()));
    await callFunction('cmsEnsurePendingCounts', { force: true }, await adminIdToken());
  }
});

test('CSV preview imports consented source rows once and refuses changed or unreviewed data', async ({ page }) => {
  const token = await adminIdToken();
  const rows = [{ ...fixture, externalId: 'outside-1', email: 'external-pitch@example.test', consent: true }];
  expect((await callFunction('importSessionPitches', { source: 'outside-form', rows: [{ ...rows[0], consent: false }] }, token)).status).toBe(400);
  await signIn(page, 'e2e-admin@example.test');
  await page.goto('/admin/pitches');
  await page.getByText('Import proposals from CSV', { exact: true }).click();
  await page.getByLabel('Source name').fill('outside-form');
  await page.getByLabel('Proposal CSV').setInputFiles({ name: 'proposals.csv', mimeType: 'text/csv', buffer: Buffer.from('externalId,email,title,description,organization,format,consent\noutside-1,external-pitch@example.test,Reporting together,A practical workshop on shared local reporting. Learn to plan a project; share evidence; and reach new readers.,Example newsroom,Workshop,true') });
  await expect(page.getByText('1 proposals ready for review.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import reviewed proposals' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I reviewed these proposals/ }).check();
  await page.getByRole('button', { name: 'Import reviewed proposals' }).click();
  await expect(page.getByText(/1 imported; 0 already present/)).toBeVisible();
  const db = adminDb();
  const stored = await db.collection('session_pitches').where('source', '==', 'outside-form').get();
  const original = stored.docs[0].data();
  const importedRows = [{ ...rows[0], description: original.description }];
  expect(await callFunction('importSessionPitches', { source: 'outside-form', rows: importedRows }, token)).toMatchObject({ status: 200, body: { imported: 0, unchanged: 1 } });
  expect((await callFunction('importSessionPitches', { source: 'outside-form', rows: [{ ...importedRows[0], title: 'Changed' }] }, token)).status).toBe(409);
  await stored.docs[0].ref.delete();
});

test('closed call retains entries and six themes work in both modes', async ({ page }) => {
  page.on('pageerror', (err) => console.error('Browser error:', err.message));
  const themeRef = adminDb().collection('config').doc('theme');
  const themeBefore = (await themeRef.get()).data();
  try {
  await page.goto('/pitch');
  await page.getByLabel('Session title', { exact: true }).fill('Keep my idea');
  await adminDb().collection('config').doc('pitch_call').set({ enabled: true, closesAt: '2000-01-01T00:00:00Z' });
  await expect(page.getByText('Submissions are closed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit pitch' })).toBeDisabled();
  await expect(page.getByLabel('Session title', { exact: true })).toHaveValue('Keep my idea');
  // Use the live theme owner so each preset and mode reaches the form.
  for (const style of ['civic', 'newsroom', 'broadsheet', 'atlas', 'field-guide', 'zine']) {
    for (const mode of ['light', 'dark']) {
      await adminDb().collection('config').doc('theme').update({ preset: style, mode });
      await page.goto('/pitch');
      await expect(page.locator('html')).toHaveAttribute('data-theme', style);
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
      await expect(page.getByRole('heading', { name: 'Pitch a session' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
  } finally { await themeRef.set(themeBefore); }
});

test('an external form call links out from the home page and /pitch, then leaves when closed', async ({ page }) => {
  page.on('pageerror', (err) => console.error('Browser error:', err.message));
  const ref = adminDb().collection('config').doc('pitch_call');
  const form = 'https://airtable.com/appExample/shrExample';
  await ref.set({ enabled: true, closesAt: '2030-11-30T23:59:59Z', externalFormUrl: form });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const action = page.getByRole('link', { name: 'Pitch a session' });
    await expect(action).toBeVisible();
    await shot(page, `external-home-${viewport.width}`);
    await action.click();
    await expect(page).toHaveURL(/\/pitch$/);
    const link = page.getByRole('link', { name: /Open the pitch form/ });
    await expect(link).toHaveAttribute('href', form);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(page.getByLabel('Session title', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `external-pitch-${viewport.width}`);
  }
  await ref.set({ enabled: true, closesAt: '2000-01-01T00:00:00Z', externalFormUrl: form });
  await expect(page.getByText('Submissions are closed', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open the pitch form/ })).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pitch a session' })).toHaveCount(0);
  await ref.set({ enabled: true, closesAt: '2030-11-30T23:59:59Z' });
});
