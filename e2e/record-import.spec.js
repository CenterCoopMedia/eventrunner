// Import records (staff CSV import), on the real surface: the sign-in page,
// the admin page, the deployed importRecordsCsv function in the emulator,
// and Firestore.
//
// One record type end to end. The seeded operator uploads an organizations
// CSV, maps it (the template headers map themselves), previews it, confirms
// it, and the two organizations exist as hidden drafts with no live
// document and no mail sent. The same file uploaded again previews as
// "No change" on every row and offers nothing to import.
//
// Then a published speaker, through the deployed function and the real
// onSpeakerWritten trigger: a re-import that changes an approved speaker
// queues the change for review, and speakers_public does not move until
// staff apply it.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, adminIdToken, callFunction, mailFileSize, signIn } from './helpers.mjs';

const RUN = Date.now();
const SLUGS = [`e2e-import-press-${RUN}`, `e2e-import-fund-${RUN}`];
const CSV = [
  'external_id,name,slug,tier,website,description,order',
  `E2E-ORG-${RUN}-1,Import Press ${RUN},${SLUGS[0]},Gold,https://press.example.org,A press that funds fellowships.,1`,
  `E2E-ORG-${RUN}-2,Import Fund ${RUN},${SLUGS[1]},Silver,,A fund for local desks.,2`,
  '',
].join('\n');

async function uploadCsv(page) {
  await page.getByLabel('CSV file').setInputFiles({
    name: 'organizations.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV, 'utf8'),
  });
  await expect(page.getByText('organizations.csv · 2 rows')).toBeVisible();
}

test.describe.serial('import records: upload -> preview -> import, organizations', () => {
  test.afterAll(async () => {
    const db = adminDb();
    for (const slug of SLUGS) {
      await db.doc(`cmsOrganizations_drafts/${slug}`).delete();
      await db.doc(`cmsOrganizations/${slug}`).delete();
    }
    const keys = await db.collection('record_imports').where('type', '==', 'organizations').get();
    await Promise.all(keys.docs.filter((doc) => SLUGS.includes(doc.data().docId)).map((doc) => doc.ref.delete()));
  });

  test('a previewed and confirmed file becomes hidden drafts, and sends no mail', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/import');
    await expect(page.getByRole('heading', { level: 1, name: 'Import records' })).toBeVisible();
    await page.getByLabel('Record type').selectOption('organizations');
    await uploadCsv(page);
    await expect(page.getByLabel('External ID (required)')).toHaveValue('external_id');
    await expect(page.getByLabel('Website')).toHaveValue('website');

    await page.getByRole('button', { name: 'Preview import' }).click();
    const preview = page.getByRole('region', { name: /Preview: organizations/ });
    await expect(preview).toBeVisible();
    await expect(preview.getByText(`Import Press ${RUN}`)).toBeVisible();
    await expect(preview.getByText('New', { exact: true })).toHaveCount(2);
    // A preview writes nothing.
    expect((await adminDb().doc(`cmsOrganizations_drafts/${SLUGS[0]}`).get()).exists).toBe(false);

    const mailBefore = mailFileSize();
    await page.getByRole('button', { name: 'Import 2 organizations as drafts' }).click();
    await expect(page.getByText(/^Imported: 2 new, 0 updates, 0 no change, 0 errors\./)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open organizations' })).toBeVisible();

    const db = adminDb();
    const draft = (await db.doc(`cmsOrganizations_drafts/${SLUGS[0]}`).get()).data();
    expect(draft).toMatchObject({
      name: `Import Press ${RUN}`,
      tier: 'Gold',
      url: 'https://press.example.org/',
      order: 1,
      visible: false,
      status: 'dirty',
    });
    expect((await db.doc(`cmsOrganizations_drafts/${SLUGS[1]}`).get()).data().visible).toBe(false);
    for (const slug of SLUGS) {
      expect((await db.doc(`cmsOrganizations/${slug}`).get()).exists).toBe(false);
    }
    const logs = await db.collection('admin_logs').where('action', '==', 'records-import').get();
    expect(logs.docs.some((doc) => doc.data().details?.type === 'organizations' && doc.data().details?.create === 2)).toBe(true);
    expect(mailFileSize()).toBe(mailBefore);
  });

  test('the same file again previews as no change and offers nothing to import', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/import');
    await page.getByLabel('Record type').selectOption('organizations');
    await uploadCsv(page);
    await page.getByRole('button', { name: 'Preview import' }).click();
    const preview = page.getByRole('region', { name: /Preview: organizations/ });
    await expect(preview.getByText('No change', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Nothing to import. Every row is unchanged or has an error.')).toBeVisible();
    await expect(page.getByRole('button', { name: /as drafts/ })).toHaveCount(0);
  });
});

test.describe.serial('import records: a published speaker is never changed in place', () => {
  const SPEAKER_SLUG = `e2e-import-ada-${RUN}`;
  const MAPPING = { externalId: 'id', firstName: 'first', lastName: 'last', slug: 'slug', jobTitle: 'title' };
  const row = (title) => ({ id: `E2E-SPK-${RUN}`, first: 'Ada', last: `Import${RUN}`, slug: SPEAKER_SLUG, title });
  let speakerId = null;

  async function importRows(token, rows) {
    const body = { type: 'speakers', mapping: MAPPING, rows };
    const preview = await callFunction('importRecordsCsv', { ...body, dryRun: true }, token);
    expect(preview.status).toBe(200);
    const commit = await callFunction('importRecordsCsv', { ...body, dryRun: false, confirmDigest: preview.body.digest }, token);
    expect(commit.status).toBe(200);
    return commit.body;
  }

  test.afterAll(async () => {
    if (!speakerId) return;
    const db = adminDb();
    await db.doc(`speakers/${speakerId}`).delete();
    await db.doc(`speaker_slugs/${SPEAKER_SLUG}`).delete();
    const keys = await db.collection('record_imports').where('docId', '==', speakerId).get();
    await Promise.all(keys.docs.map((doc) => doc.ref.delete()));
    await expect.poll(async () => (await db.doc(`speakers_public/${speakerId}`).get()).exists, { timeout: 20_000 }).toBe(false);
  });

  test('the change waits as pending edits, and speakers_public moves only when staff apply it', async () => {
    const token = await adminIdToken();
    const db = adminDb();
    const created = await importRows(token, [row('Editor')]);
    expect(created.rows[0].verdict).toBe('create');
    speakerId = created.rows[0].docId;

    // Staff approve the speaker; the trigger publishes it.
    await db.doc(`speakers/${speakerId}`).set({ status: 'approved' }, { merge: true });
    const publicRef = db.doc(`speakers_public/${speakerId}`);
    await expect.poll(async () => (await publicRef.get()).data()?.jobTitle, { timeout: 20_000 }).toBe('Editor');

    const mailBefore = mailFileSize();
    const changed = await importRows(token, [row('Placeholder title')]);
    expect(changed.rows[0].verdict).toBe('update');
    expect(changed.rows[0].notes.join(' ')).toMatch(/pending review/);
    const speaker = (await db.doc(`speakers/${speakerId}`).get()).data();
    expect(speaker.jobTitle).toBe('Editor');
    expect(speaker.pendingEdits).toEqual({ jobTitle: 'Placeholder title' });

    // The import's write woke the trigger. Give it time to run, then check
    // that the public speaker did not move.
    await new Promise((resolve) => { setTimeout(resolve, 3000); });
    expect((await publicRef.get()).data()?.jobTitle).toBe('Editor');
    expect(mailFileSize()).toBe(mailBefore);

    // Staff apply the change on the Speakers page; only now is it public.
    const applied = await callFunction('applySpeakerPendingEdits', { speakerId }, token);
    expect(applied.status).toBe(200);
    await expect.poll(async () => (await publicRef.get()).data()?.jobTitle, { timeout: 20_000 }).toBe('Placeholder title');
  });
});
