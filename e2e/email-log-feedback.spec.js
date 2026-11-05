// Hosted synthetic read failures: a bottom-of-page action keeps its result visible.
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, APP_BASE_URL, signIn } from './helpers.mjs';

test('the email pager shows a recoverable failure where the operator clicked', async ({ page }) => {
  test.setTimeout(120_000);
  const headers = { 'access-control-allow-origin': APP_BASE_URL, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-firebase-appcheck' };
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: `log-proof-${index}`, sentAt: Date.now() - index * 60000,
    to: `reader-${index}@example.test`, subject: `Event guide ${index + 1}`,
    source: 'announcement', status: 'sent', bodyStored: false,
  }));
  let reads = 0;
  await page.route('**/listSentEmails', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    reads += 1;
    if (reads === 2) return route.fulfill({ status: 503, headers, json: { error: { code: 'unavailable', message: 'Please try again.' } } });
    return route.fulfill({ status: 200, headers, json: reads === 1
      ? { rows, nextCursor: { sentAt: rows.at(-1).sentAt, id: rows.at(-1).id }, scanned: 25 }
      : { rows: [{ ...rows[0], id: 'older-proof', subject: 'The older message' }], nextCursor: null, scanned: 1 } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/email-log');
  const more = page.getByRole('button', { name: 'Load more', exact: true });
  await more.click();
  const retry = page.getByRole('button', { name: 'Retry loading older messages' });
  const result = page.getByRole('alert');
  await expect(retry).toBeFocused();
  await expect(retry).toBeInViewport();
  await expect(result).toBeInViewport();
  await expect(result).toContainText('Older messages could not be loaded.');
  const directory = path.resolve('test-results/admin-visual-evidence');
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, 'email-log-retry-390.png'), animations: 'disabled' });
  await retry.click();
  await expect(page.getByText('The older message', { exact: true })).toBeVisible();
  await expect(result).toHaveCount(0);
  expect(reads).toBe(3);
});
