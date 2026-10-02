// Speaker materials (issue #213): the real speaker dashboard lists, submits,
// and locks materials through the emulator Functions and Storage services.
// The only file is a small synthetic buffer made in this test.
import { test, expect } from '@playwright/test';
import { getStorage } from 'firebase-admin/storage';
import {
  PROJECT_ID,
  adminApp,
  adminAuth,
  adminDb,
  adminIdToken,
  callFunction,
  ensureUser,
  idTokenFor,
  signIn,
} from './helpers.mjs';

function bucket() {
  return getStorage(adminApp()).bucket(process.env.EVENT_STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`);
}

test.describe.serial('speaker session materials', () => {
  const stamp = Date.now();
  const email = `e2e-speaker-materials-${stamp}@example.test`;
  const speakerId = `e2e-speaker-materials-${stamp}`;
  const sessionId = `e2e-speaker-materials-session-${stamp}`;
  const foreignSessionId = `e2e-speaker-materials-foreign-${stamp}`;
  const sessionTitle = `Material upload session ${stamp}`;
  const syntheticBytes = Buffer.from(`Synthetic speaker handout ${stamp}\n`);
  let uid;

  test.beforeAll(async () => {
    uid = await ensureUser(email);
    const db = adminDb();
    const at = new Date();
    await db.collection('users').doc(uid).set({
      uid,
      email,
      displayName: `Material Speaker ${stamp}`,
      visibility: 'private',
      registrationStatus: 'approved',
      speakerId,
      createdAt: at,
      updatedAt: at,
    });
    await db.collection('speakers').doc(speakerId).set({
      firstName: 'Material',
      lastName: `Speaker ${stamp}`,
      slug: speakerId,
      email,
      status: 'approved',
      uid,
      createdAt: at,
      updatedAt: at,
    });
    const session = {
      dayId: 'day-1',
      startTime: '10:00',
      endTime: '11:00',
      description: 'A session used only by the speaker materials browser test.',
      location: 'Test room',
      type: 'workshop',
      visible: true,
      materialCount: 0,
    };
    await db.collection('cmsSchedule').doc(sessionId).set({
      ...session,
      title: sessionTitle,
      speakerIds: [speakerId],
    });
    await db.collection('cmsSchedule').doc(foreignSessionId).set({
      ...session,
      title: `Foreign material session ${stamp}`,
      visible: false,
      speakerIds: ['another-speaker'],
    });
  });

  test.afterAll(async () => {
    const db = adminDb();
    const materials = await db.collection('session_materials').where('sessionId', '==', sessionId).get();
    for (const row of materials.docs) {
      const path = row.data().storagePath;
      if (typeof path === 'string' && path) await bucket().file(path).delete({ ignoreNotFound: true });
      await row.ref.delete();
      await db.collection('session_materials_public').doc(row.id).delete();
    }
    await db.collection('cmsSchedule').doc(sessionId).delete();
    await db.collection('cmsSchedule').doc(foreignSessionId).delete();
    await db.collection('speakers').doc(speakerId).delete();
    await db.collection('users').doc(uid).delete();
    if (uid) await adminAuth().deleteUser(uid).catch(() => {});
  });

  test('an own-session link and file enter review, while foreign and reviewed changes are refused', async ({ page }) => {
    await signIn(page, email);
    await page.goto('/speaker/dashboard');
    await expect(page.getByRole('heading', { name: 'Speaker dashboard' })).toBeVisible();
    await expect(page.getByLabel('Session')).toHaveValue(sessionId);

    await page.getByRole('tab', { name: 'Materials' }).click();
    await expect(page.getByText('No materials have been sent for this session.')).toBeVisible();

    await page.getByLabel('Link URL').fill('https://example.org/speaker-slides');
    await page.getByLabel('Display name').fill('Speaker slides');
    await page.getByRole('button', { name: 'Send link' }).click();
    await expect(page.getByText('Link sent for organizer review.')).toBeVisible();
    await expect(page.getByText('Speaker slides')).toBeVisible();

    await page.getByLabel('File').setInputFiles({
      name: 'speaker-handout.txt',
      mimeType: 'text/plain',
      buffer: syntheticBytes,
    });
    await page.getByRole('button', { name: 'Upload file' }).click();
    await expect(page.getByText('File sent for organizer review.')).toBeVisible();
    await expect(page.getByText('speaker-handout.txt')).toBeVisible();

    const materialSnap = await adminDb().collection('session_materials').where('sessionId', '==', sessionId).get();
    expect(materialSnap.size).toBe(2);
    const materials = materialSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const link = materials.find((material) => material.type === 'link');
    const file = materials.find((material) => material.type === 'file');
    expect(link.reviewStatus).toBe('pending');
    expect(file.reviewStatus).toBe('pending');
    expect(file.storagePath).toMatch(new RegExp(`^session-materials/${sessionId}/[^/]+$`));
    const [storedBytes] = await bucket().file(file.storagePath).download();
    expect(storedBytes.equals(syntheticBytes)).toBe(true);

    const speakerToken = await idTokenFor(uid);
    const foreign = await callFunction(
      'addSessionMaterialLink',
      { sessionId: foreignSessionId, url: 'https://example.org/foreign', label: 'Foreign' },
      speakerToken,
    );
    expect(foreign.status).toBe(403);

    const adminToken = await adminIdToken();
    const reviewed = await callFunction(
      'setMaterialReviewStatus',
      { materialId: link.id, reviewStatus: 'approved' },
      adminToken,
    );
    expect(reviewed.status).toBe(200);
    const locked = await callFunction(
      'updateSessionMaterial',
      { materialId: link.id, filename: 'Changed after review' },
      speakerToken,
    );
    expect(locked.status).toBe(403);

    await page.getByRole('tab', { name: 'Details' }).click();
    await page.getByRole('tab', { name: 'Materials' }).click();
    const reviewedRow = page.locator('li').filter({ hasText: 'Speaker slides' });
    await expect(reviewedRow.getByText('Approved')).toBeVisible();
    await expect(reviewedRow.getByText(/organizer has reviewed this item/i)).toBeVisible();
    await expect(reviewedRow.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  });
});
