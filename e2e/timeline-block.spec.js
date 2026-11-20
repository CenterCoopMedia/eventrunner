import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { getStorage } from 'firebase-admin/storage';
import { ADMIN_EMAIL, PROJECT_ID, adminApp, adminAuth, adminDb, ensureUser } from './helpers.mjs';

test.use({ screenshot: 'off', trace: 'off' });

test('publish a linked and illustrated timeline on a page other than Home', async ({ page, browser }) => {
  test.setTimeout(45_000);
  const db = adminDb();
  const pageId = 'e2e-timeline-archive';
  const section = 'e2e-timeline-editions';
  const pagePath = '/e2e-timeline-archive';
  const imagePath = 'cms-images/e2e-timeline-gathering/gathering.webp';
  const alt = 'Attendees talking around a table';
  const title = 'Community workshops';
  const olderTitle = 'First gathering';
  const pageDoc = db.doc(`cmsPages/${pageId}`);
  const faq = db.doc(`cmsContent/${section}__faq`);
  const earlier = db.doc(`cmsTimeline/${pageId}`);
  const hidden = db.doc(`cmsTimeline/${pageId}-hidden`);
  const asset = db.doc('media_assets/e2e-timeline-gathering');
  const object = getStorage(adminApp()).bucket(process.env.EVENT_STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`).file(imagePath);
  let entryId;
  let blockId;
  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const uid = await ensureUser(ADMIN_EMAIL);
    await Promise.all([
      db.doc(`users/${uid}`).set({ uid, email: ADMIN_EMAIL, displayName: 'Fixture organizer', profileVisibility: 'private' }, { merge: true }),
      pageDoc.set({
        id: pageId, label: 'Event archive', path: pagePath, layout: 'article', visible: true,
        sections: [{ id: section, label: 'Past editions', allowedBlocks: [], defaultBlocks: [], maxBlocks: 4 }],
      }),
      earlier.set({ year: 2022, title: olderTitle, url: '/schedule', visible: true }),
      hidden.set({ year: 2024, title: 'Unlisted practice event', visible: false }),
      faq.set({ section, field: 'faq', blockType: 'faq_item', question: 'Can I share this page?', answer: '<p>Yes.</p>', visible: true }),
      asset.set({ folder: 'cms-images', path: imagePath, filename: 'gathering.webp', title: 'Table gathering' }),
      object.save(await readFile(resolve('apps/web/public/demo/summit-gathering.webp')), { contentType: 'image/webp' }),
    ]);
    await page.goto('/signin');
    await page.evaluate(async ({ moduleUrl, token }) => {
      const { signInWithEmulatorToken } = await import(moduleUrl);
      await signInWithEmulatorToken(token);
    }, { moduleUrl: `/@fs/${resolve('e2e/browser-auth.js')}`, token: await adminAuth().createCustomToken(uid) });

    await page.goto('/admin/timeline/new/entry');
    await page.getByRole('textbox', { name: 'Year', exact: true }).fill('2025');
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Description', { exact: true }).fill('A day of workshops and conversations.');
    await page.getByLabel('Link', { exact: true }).fill('https://example.org/workshops');
    await page.getByRole('button', { name: 'Choose or upload…' }).click();
    await page.getByRole('dialog', { name: 'Choose an image' }).getByRole('button', { name: /^Table gathering/ }).click();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByLabel('Alt text', { exact: true })).toBeFocused();
    await expect(page.getByText('Describe the image in 240 characters or fewer.')).toBeVisible();
    await page.getByLabel('Alt text', { exact: true }).fill(alt);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/timeline\/[0-9a-f-]+$/);
    entryId = new URL(page.url()).pathname.split('/').at(-1);
    expect((await db.doc(`cmsTimeline/${entryId}`).get()).data()).toMatchObject({ image: imagePath, alt });

    await page.goto(`/admin/content/${pageId}/${section}/_new`);
    const timelineOption = page.getByRole('radio', { name: 'Timeline', exact: true });
    await expect(timelineOption).toHaveAccessibleDescription('Past editions in order, with optional links and images.');
    await timelineOption.check();
    await expect(page.getByRole('main').getByRole('link', { name: 'Timeline', exact: true })).toHaveAttribute('href', '/admin/timeline');
    await page.getByRole('button', { name: 'Save and publish', exact: true }).click({ timeout: 5_000 });
    await expect(page.getByText('Published.', { exact: true }).first()).toBeVisible();
    const blocks = await db.collection('cmsContent').where('section', '==', section).get();
    const timelines = blocks.docs.filter((doc) => doc.data().blockType === 'timeline');
    expect(timelines).toHaveLength(1);
    blockId = timelines[0].id;

    await visitor.goto(pagePath);
    await expect(visitor.getByRole('heading', { name: 'Event archive' })).toBeVisible();
    const linkedEntry = { name: `${title} (opens in a new tab)`, exact: true };
    const list = visitor.getByRole('list').filter({ has: visitor.getByRole('link', linkedEntry) });
    await expect(list).toHaveJSProperty('tagName', 'OL');
    const older = list.getByRole('link', { name: olderTitle, exact: true });
    const newer = list.getByRole('link', linkedEntry);
    await expect(older).toHaveAttribute('href', '/schedule');
    await older.focus();
    await visitor.keyboard.press('Tab');
    await expect(newer).toBeFocused();
    await expect(newer).toHaveAttribute('href', 'https://example.org/workshops');
    await expect(newer).toHaveAttribute('target', '_blank');
    await expect(newer).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(list.getByText('A day of workshops and conversations.')).toBeVisible();
    const picture = list.getByRole('img', { name: alt });
    await picture.scrollIntoViewIfNeeded();
    await expect(picture).toHaveAttribute('src', new RegExp(`/o/${encodeURIComponent(imagePath)}\\?alt=media$`));
    await expect.poll(() => picture.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    const filter = visitor.getByRole('searchbox', { name: 'Filter by keyword' });
    for (const query of [title, '2025', 'conversations']) {
      await filter.fill(query);
      await expect(newer).toBeVisible();
      await expect(visitor.getByText('Can I share this page?')).toBeHidden();
    }
    await filter.fill('Unlisted practice event');
    await expect(newer).toBeHidden();
  } finally {
    const docs = [pageDoc, faq, earlier, hidden, asset];
    if (entryId) docs.push(db.doc(`cmsTimeline/${entryId}`), db.doc(`cmsTimeline_drafts/${entryId}`));
    if (blockId) docs.push(db.doc(`cmsContent/${blockId}`), db.doc(`cmsContent_drafts/${blockId}`));
    await Promise.all([visitor.close(), object.delete({ ignoreNotFound: true }), ...docs.map((doc) => doc.delete())]);
  }
});
