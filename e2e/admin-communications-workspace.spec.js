// Real emulator-backed communication workspace and review evidence.
/* global document */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, mailFileSize, signIn } from './helpers.mjs';

const RUN = Date.now().toString(36);
const READER_ID = `communications-reader-${RUN}`;
const MESSAGE_ID = `communications-message-${RUN}`;
const SUBJECT = 'Your event guide';
const MESSAGE = 'Here is what you need to know for the event:\n\nDoors open at nine. Bring your badge and allow time to check in.\n\nThe full schedule has session times, rooms and speaker details.';

test('communications keeps drafts and review state across channels and fits desktop and mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const db = adminDb();
  await db.collection('users').doc(READER_ID).set({
    email: `communications-reader-${RUN}@example.test`,
    displayName: 'Event guide reader',
    registrationStatus: 'approved',
    approvalSource: 'admin',
    speakerId: null,
    role: 'attendee',
  });
  await db.collection('announcement_messages').doc(MESSAGE_ID).set({
    name: 'Event guide', subject: SUBJECT, message: MESSAGE,
    linkUrl: 'https://example.org/schedule', linkLabel: 'Read the schedule',
    createdAt: new Date(), updatedAt: new Date(),
  });

  const evidenceDir = path.resolve('test-results/admin-visual-evidence');
  await fs.mkdir(evidenceDir, { recursive: true });

  async function capture(name, viewport) {
    await page.setViewportSize(viewport);
    await page.locator('html').evaluate((element) => {
      element.ownerDocument.defaultView.scrollTo(0, 0);
      return element.ownerDocument.fonts.ready;
    });
    const geometry = await page.evaluate(() => {
      const root = document.documentElement;
      const writer = document.querySelector('.admin-email-workspace__writer').getBoundingClientRect();
      const review = document.querySelector('.admin-email-workspace__review').getBoundingClientRect();
      const controls = [...document.querySelectorAll('#admin-content input, #admin-content select, #admin-content textarea, #admin-content button')]
        .filter((control) => control.getClientRects().length > 0);
      return {
        viewportWidth: root.clientWidth,
        pageWidth: root.scrollWidth,
        writer: { top: writer.top, right: writer.right, bottom: writer.bottom, width: writer.width },
        review: { top: review.top, left: review.left, width: review.width },
        controlsFit: controls.every((control) => {
          const box = control.getBoundingClientRect();
          return box.left >= -1 && box.right <= root.clientWidth + 1;
        }),
      };
    });
    expect(geometry.pageWidth, `page fits at ${viewport.width}`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.controlsFit, `controls fit at ${viewport.width}`).toBe(true);
    if (viewport.width >= 1280) {
      expect(Math.abs(geometry.writer.top - geometry.review.top)).toBeLessThanOrEqual(1);
      expect(geometry.review.left).toBeGreaterThan(geometry.writer.right);
      expect(geometry.writer.width / geometry.review.width).toBeCloseTo(11 / 9, 1);
    } else {
      expect(geometry.review.top).toBeGreaterThan(geometry.writer.bottom);
    }
    await page.screenshot({ path: path.join(evidenceDir, `${name}-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
  }

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/announcements');
    const endTour = page.getByRole('button', { name: 'End tour', exact: true });
    if (await endTour.isVisible()) await endTour.click();
    const beforeDraft = mailFileSize();
    const banners = page.getByRole('tab', { name: 'Site banners' });
    const email = page.getByRole('tab', { name: 'Email', exact: true });
    await expect(banners).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Message', { exact: true }).fill('Use the east entrance.');
    await banners.focus();
    await page.keyboard.press('End');
    await expect(email).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Write your email' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your preview will appear here' })).toBeVisible();
    await page.getByLabel('Audience').selectOption({ label: 'Approved attendees' });
    await page.getByLabel('Subject', { exact: true }).fill(SUBJECT);
    await page.getByLabel('Email message').fill(MESSAGE);
    await page.getByLabel('Button link (optional)').fill('https://example.org/schedule');
    await page.getByLabel('Button label (optional)').fill('Read the schedule');
    await expect(page.getByRole('heading', { name: 'Saved messages' })).toBeVisible();
    await expect(page.getByText('Event guide', { exact: true })).toBeVisible();

    await banners.click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Use the east entrance.');
    await email.click();
    await expect(page.getByLabel('Subject', { exact: true })).toHaveValue(SUBJECT);
    await expect(page.getByLabel('Email message')).toHaveValue(MESSAGE);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) {
      await capture('communications-compose', viewport);
    }

    await page.getByRole('button', { name: 'Preview email', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Preview', exact: true })).toBeFocused();
    const recipients = page.getByText(/^\d+ recipients?: Approved attendees$/);
    await expect(recipients).toBeVisible();
    const recipientText = await recipients.textContent();
    await expect(page.frameLocator('iframe[title="Email preview"]').getByText('Doors open at nine. Bring your badge and allow time to check in.')).toBeVisible();
    await banners.click();
    await email.click();
    await expect(recipients).toHaveText(recipientText);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await capture('communications-preview', viewport);
    }

    // Editing invalidates the server preview and removes every send action.
    await page.getByLabel('Subject', { exact: true }).fill(`${SUBJECT}: updated`);
    await expect(page.getByRole('heading', { name: 'Your preview will appear here' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Preview', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Send to \d+/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send a test to me' })).toHaveCount(0);
    expect(mailFileSize()).toBe(beforeDraft);
    await expect(page.getByRole('link', { name: 'Open email log', exact: true })).toHaveAttribute('href', '/admin/email-log');
  } finally {
    await db.collection('users').doc(READER_ID).delete();
    await db.collection('announcement_messages').doc(MESSAGE_ID).delete();
  }
});
