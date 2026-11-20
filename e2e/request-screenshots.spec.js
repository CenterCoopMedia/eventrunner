import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { adminDb, adminIdToken } from './helpers.mjs';

test('a signed-out visitor attaches screenshots and only staff can open the sanitized result', async ({ page }) => {
  const db = adminDb();
  const flagsRef = db.doc('config/features');
  const flags = (await flagsRef.get()).data();
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: 'white' } }).png().toBuffer();
  let receipt;
  try {
    await flagsRef.set({ feedbackInbox: true }, { merge: true });
    // The public form has a minimum elapsed-time gate. A valid form age keeps
    // this browser test from spending three seconds waiting on the clock.
    await page.clock.setFixedTime(new Date(Date.now() - 5000));
    await page.goto('/');
    await page.getByRole('button', { name: 'Share feedback' }).click();
    const form = page.getByRole('dialog', { name: 'Share feedback' });
    const message = form.getByRole('textbox', { name: 'Message' });
    const keepTextPaste = await message.evaluate((element, data) => {
      const clipboardData = new globalThis.DataTransfer();
      clipboardData.setData('text/plain', 'A text selection from a spreadsheet');
      clipboardData.items.add(new File([new Uint8Array(data)], 'table.png', { type: 'image/png' }));
      return element.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, [...png]);
    expect(keepTextPaste).toBe(true);
    await expect(form.getByRole('list', { name: 'Selected screenshots' })).toHaveCount(0);
    await message.fill('The map label is hard to read.');
    await form.getByLabel('Screenshots (optional)').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: png });
    await message.evaluate((element, data) => {
      const clipboardData = new globalThis.DataTransfer();
      clipboardData.items.add(new File([new Uint8Array(data)], 'pasted.png', { type: 'image/png' }));
      element.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, [...png]);
    await form.getByText('Choose, paste, or drop', { exact: false }).evaluate((element, data) => {
      const dataTransfer = new globalThis.DataTransfer();
      dataTransfer.items.add(new File([new Uint8Array(data)], 'dropped.png', { type: 'image/png' }));
      element.dispatchEvent(new globalThis.DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
    }, [...png]);
    await expect(form.getByText('3 of 3 screenshots selected.')).toBeVisible();
    await page.keyboard.press('Escape');
    const keep = form.getByRole('button', { name: 'Keep writing' });
    const discard = form.getByRole('button', { name: 'Discard draft' });
    await expect(keep).toBeFocused();
    await expect(keep).toHaveAccessibleDescription('Discard your draft?');
    await page.keyboard.press('Shift+Tab');
    await expect(discard).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(keep).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(keep).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(message).toBeFocused();
    await expect(message).toHaveValue('The map label is hard to read.');
    await expect(form.getByText('3 of 3 screenshots selected.')).toBeVisible();
    const saved = page.waitForResponse((response) => response.url().endsWith('/submitFeedback') && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Send feedback' }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    receipt = (await response.json()).id;
    expect(receipt).toBeTruthy();
    const request = { source: 'feedback', id: receipt, index: 2 };
    const endpoint = new URL('readRequestScreenshot', response.url()).href;
    expect((await page.request.post(endpoint, { data: request })).status()).toBe(401);
    const headers = { Authorization: `Bearer ${await adminIdToken()}` };
    const opened = await page.request.post(endpoint, { data: request, headers });
    expect(opened.status()).toBe(200);
    const image = await sharp(Buffer.from((await opened.json()).image, 'base64')).metadata();
    expect(image).toMatchObject({ format: 'webp', width: 40, height: 30 });
    const imageRef = db.doc(`request_screenshots/feedback-${receipt}-2`);
    const createdAt = (await db.doc(`feedback/${receipt}`).get()).get('createdAt');
    const expiresAt = (await imageRef.get()).get('expiresAt');
    expect(expiresAt.toMillis() - createdAt.toMillis()).toBe(30 * 24 * 60 * 60 * 1000);
    await imageRef.update({ expiresAt: new Date(0) });
    expect((await page.request.post(endpoint, { data: request, headers })).status()).toBe(404);
  } finally {
    await flagsRef.set(flags);
    if (receipt) {
      const batch = db.batch();
      batch.delete(db.doc(`feedback/${receipt}`));
      for (const index of [0, 1, 2]) batch.delete(db.doc(`request_screenshots/feedback-${receipt}-${index}`));
      await batch.commit();
    }
  }
});
