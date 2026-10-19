// Import records (staff CSV import), on the real surface: the sign-in page,
// the admin page, the deployed importRecordsCsv function in the emulator,
// and Firestore.
//
// One record type end to end. The seeded operator uploads an organizations
// CSV, maps it (the template headers map themselves), previews it, confirms
// it, and the two organizations exist as hidden drafts with no live
// document and no mail sent. The same file uploaded again previews as
// "No change" on every row and offers nothing to import.
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, mailFileSize, signIn } from './helpers.mjs';

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
    await Promise.all(keys.docs.filter((doc) => String(doc.data().externalId).includes(String(RUN))).map((doc) => doc.ref.delete()));
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
