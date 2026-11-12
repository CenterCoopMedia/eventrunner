// Real delete/restore endpoints and emulator records; browser proof runs in CI.
/* global getComputedStyle */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import store from '../functions/src/cms/store.cjs';
import { ADMIN_EMAIL, adminDb, signIn } from './helpers.mjs';

const actor = { uid: 'undo-fixture', email: 'undo-fixture@example.test' };
let records;
let extraPaths;

test.beforeEach(() => { records = []; extraPaths = []; });
test.afterEach(async () => {
  const db = adminDb();
  for (const { collection, id } of records.reverse()) {
    await store.deleteBoth({ db, collection, docId: id });
    const history = await db.collection('cmsVersionHistory').where('docPath', '==', `${collection}/${id}`).get();
    for (const row of history.docs) await row.ref.delete();
  }
  for (const docPath of extraPaths) await db.doc(docPath).delete();
});

async function fixture(kind) {
  const db = adminDb();
  let id = `undo655-${kind}-${Date.now()}`;
  const title = `Published ${id}`;
  const pageFields = { id, label: title, path: `/${id}`, icon: null, order: 99, systemPage: false, sections: [] };
  const options = {
    page: { collection: 'cmsPages', fields: pageFields, route: `/admin/pages/${id}`, list: '/admin/pages', field: 'Navigation label', key: 'label', remove: 'Delete this page' },
    update: { collection: 'cmsUpdates', fields: { title, body: 'Last published text.', publishAt: null, pinned: false, category: null, featured: false }, route: `/admin/updates/${id}`, list: '/admin/updates', field: 'Title', key: 'title', remove: 'Delete this update' },
    timeline: { collection: 'cmsTimeline', fields: { year: 2026, title, description: 'Last published description.' }, route: `/admin/timeline/${id}`, list: '/admin/timeline', field: 'Title', key: 'title', remove: 'Delete this entry' },
    organization: { collection: 'cmsOrganizations', fields: { name: title, tier: 'Community', description: 'Last published description.', order: 99 }, route: `/admin/organizations/${id}`, list: '/admin/organizations', field: 'Name', key: 'name', remove: 'Delete this organization' },
  };
  if (kind === 'session') {
    const event = (await db.doc('config/event').get()).data();
    options.session = { collection: 'cmsSchedule', fields: { title, description: 'Last published description.', dayId: event.days[0].id, startTime: '09:00', endTime: '10:00', speakerIds: [] }, route: `/admin/sessions/${id}`, list: '/admin/sessions', field: 'Public title', key: 'title', remove: 'Delete this session' };
  }
  if (kind === 'block') {
    const section = `${id}-section`;
    pageFields.sections = [{ id: section, label: 'Undo proof', description: null, allowedBlocks: ['text'], maxBlocks: 4, reorderable: true, defaultBlocks: [] }];
    await store.writeDraft({ db, collection: 'cmsPages', docId: id, fields: pageFields, actor });
    records.push({ collection: 'cmsPages', id });
    const list = `/admin/content/${id}/${section}`;
    id = `${section}__title`;
    options.block = { collection: 'cmsContent', fields: { section, field: 'title', blockType: 'text', value: title, order: 0 }, route: `${list}/title`, list, field: 'Text', key: 'value', remove: 'Delete this block' };
  }
  const record = { ...options[kind], id };
  records.push(record);
  // Two real publishes prove Undo selects the latest published fields,
  // rather than either the original version or the deleted dirty draft.
  await store.writeDraft({ db, collection: record.collection, docId: id, fields: { ...record.fields, [record.key]: `Original ${id}` }, actor });
  await store.publishDocs({ db, collection: record.collection, docIds: [id], actor });
  await store.writeDraft({ db, collection: record.collection, docId: id, fields: record.fields, actor });
  await store.publishDocs({ db, collection: record.collection, docIds: [id], actor });
  record.dirtyTitle = `Unpublished ${id}`;
  await store.writeDraft({ db, collection: record.collection, docId: id, fields: { ...record.fields, [record.key]: record.dirtyTitle }, actor });
  if (kind === 'update') extraPaths.push(`cmsUpdates_deleted/${id}`);
  return record;
}

async function openEditor(page, record) {
  await signIn(page, ADMIN_EMAIL);
  await page.goto(record.route);
  await expect(page.getByLabel(record.field, { exact: true })).toHaveValue(record.dirtyTitle);
  const tour = page.getByRole('button', { name: 'End tour', exact: true });
  if (await tour.isVisible()) await tour.click();
}

async function remove(page, record) {
  await page.getByRole('button', { name: record.remove, exact: true }).click();
  const confirmation = page.getByRole('region', { name: `Delete ${record.dirtyTitle}`, exact: true });
  await confirmation.getByRole('button', { name: record.remove, exact: true }).click();
  await expect(page).toHaveURL(record.list);
  return page.getByRole('status').filter({ hasText: /deleted\./ });
}

async function screenshot(page, name) {
  const directory = path.resolve('test-results/admin-visual-evidence');
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name) });
}

for (const kind of ['page', 'update', 'timeline', 'session', 'organization', 'block']) {
  test(`${kind}: confirmed delete restores only the last published version as a draft`, async ({ page }) => {
    const record = await fixture(kind);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: kind === 'page' ? 'no-preference' : 'reduce' });
    await openEditor(page, record);
    if (kind === 'page') {
      await page.goto(record.list);
      await expect(page.getByRole('heading', { name: 'Pages', exact: true, level: 1 })).toBeVisible();
      await screenshot(page, 'deletion-undo-before-1440.png');
      await page.goto(record.route);
      await expect(page.getByLabel(record.field, { exact: true })).toHaveValue(record.dirtyTitle);
    }
    const line = await remove(page, record);
    await expect(line).toHaveCount(1);
    const undo = line.getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeFocused();
    expect(await line.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    if (kind === 'page') await screenshot(page, 'deletion-undo-after-1440.png');
    const db = adminDb();
    if (kind === 'update') expect((await db.doc(`cmsUpdates_deleted/${record.id}`).get()).exists).toBe(true);
    await undo.click();
    const result = page.getByRole('status').filter({ hasText: 'is back as a draft. Publish it to show it on the site.' });
    await expect(result).toHaveCount(1);
    const link = result.getByRole('link', { name: 'Open draft', exact: true });
    await expect(link).toBeFocused();
    await expect(link).toHaveAttribute('href', record.route);
    const draft = (await db.doc(`${record.collection}_drafts/${record.id}`).get()).data();
    expect(draft.status).toBe('dirty');
    expect(store.contentFieldsOf(draft)).toEqual(record.fields);
    expect((await db.doc(`${record.collection}/${record.id}`).get()).exists).toBe(false);
    if (kind === 'update') expect((await db.doc(`cmsUpdates_deleted/${record.id}`).get()).exists).toBe(false);
    if (kind === 'page') {
      await page.setViewportSize({ width: 390, height: 844 });
      const bounds = await result.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
      await screenshot(page, 'deletion-undo-restored-390.png');
    }
    await link.click();
    await expect(page.getByLabel(record.field, { exact: true })).toHaveValue(record.fields[record.key]);
    if (kind === 'update') {
      await page.getByLabel('Title', { exact: true }).fill('Saved again after Undo');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
      expect((await db.doc(`cmsUpdates_drafts/${record.id}`).get()).data().title).toBe('Saved again after Undo');
    }
    await expect(page.getByRole('link', { name: 'Open draft', exact: true })).toHaveCount(0);
  });
}

for (const exclusion of ['never-published', 'materials', 'representatives', 'queued-edit']) {
  test(`delete with ${exclusion} states the result without offering Undo`, async ({ page }) => {
    const kind = exclusion === 'materials' ? 'session' : exclusion === 'never-published' ? 'timeline' : 'organization';
    const record = await fixture(kind);
    const db = adminDb();
    if (exclusion === 'never-published') {
      // A new draft may reuse an earlier deleted record's id. Its retained
      // history must not make that new, unpublished record eligible.
      await store.deleteBoth({ db, collection: record.collection, docId: record.id });
      await store.writeDraft({ db, collection: record.collection, docId: record.id, fields: { ...record.fields, [record.key]: record.dirtyTitle }, actor });
    } else if (exclusion === 'materials') {
      const material = { sessionId: record.id, type: 'link', filename: 'Slides', url: 'https://example.test/slides', reviewStatus: 'approved' };
      for (const collection of ['session_materials', 'session_materials_public']) {
        const docPath = `${collection}/${record.id}`;
        extraPaths.push(docPath);
        await db.doc(docPath).set(material);
      }
    } else if (exclusion === 'representatives' || exclusion === 'queued-edit') {
      const docPath = exclusion === 'representatives' ? `organization_representatives/${record.id}` : `organization_edit_requests/${record.id}`;
      extraPaths.push(docPath);
      await db.doc(docPath).set({ uid: record.id, organizationId: record.id, fields: { description: 'Queued' }, submittedByUid: record.id });
    }
    await openEditor(page, record);
    const line = await remove(page, record);
    await expect(line).toBeVisible();
    await expect(line.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
    if (exclusion !== 'never-published') await expect(line).toContainText('Undo is not available.');
  });
}

test('inline block deletion keeps its row and focuses Undo, then keeps the restored draft result', async ({ page }) => {
  const record = await fixture('block');
  await openEditor(page, record);
  await page.goto(record.list);
  const row = page.locator('#admin-content li').filter({ hasText: record.dirtyTitle });
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await row.getByRole('button', { name: 'Delete this block', exact: true }).click();
  const undo = row.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeFocused();
  await expect(row.getByText('Deleted', { exact: true })).toBeVisible();
  await undo.click();
  // The live listener removes the old row, and the restored draft listener
  // brings its controls back; the same result and focus must survive both.
  const restored = page.locator('li').filter({ has: page.getByRole('link', { name: record.fields.value, exact: true }) });
  await expect(restored.getByRole('link', { name: 'Open draft', exact: true })).toBeFocused();
  await expect(restored.getByRole('link', { name: `Edit ${record.fields.value}`, exact: true })).toBeVisible();
  await expect(restored.getByRole('status')).toHaveCount(1);
  await expect(page).toHaveURL(record.list);
});

test('a replacement refuses Undo with its reason and a history link, preserving the replacement', async ({ page }) => {
  const record = await fixture('organization');
  await openEditor(page, record);
  const line = await remove(page, record);
  const replacement = { name: 'Replacement organization', tier: 'Community', order: 100 };
  await store.writeDraft({ db: adminDb(), collection: record.collection, docId: record.id, fields: replacement, actor });
  await line.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(line).toContainText('Undo did not finish.');
  await expect(line).toContainText(/already|taken|exists/i);
  await expect(line.getByRole('link', { name: 'View version history' })).toHaveAttribute('href', `/admin/versions/${record.collection}/${record.id}`);
  expect(store.contentFieldsOf((await adminDb().doc(`${record.collection}_drafts/${record.id}`).get()).data())).toEqual(replacement);
});
