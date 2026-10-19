// Configure-and-refresh against a fake Airtable API. The Functions emulator
// calls this file's loopback server through EVENT_AIRTABLE_API_ORIGIN
// (scripts/dev/run-e2e.sh); a deployed function ignores that variable and
// calls only https://api.airtable.com. Synthetic records only.
/* global window, document */
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { adminDb, signIn, ADMIN_EMAIL } from './helpers.mjs';

const origin = new URL(process.env.EVENT_AIRTABLE_API_ORIGIN || 'http://127.0.0.1:5197');
const token = process.env.AIRTABLE_API_TOKEN || 'e2e-airtable-token';
const BASE = 'appE2EAAAAAAAAAAA';
const TABLE = 'tblE2EBBBBBBBBBBB';
const recId = (n) => `recE2E${String(n).padStart(11, '0')}`;
const record = (n, fields = {}) => ({ id: recId(n), fields: { email: `airtable-${n}@example.test`, title: `Airtable pitch ${n}`, description: `A practical session from the Airtable form, number ${n}.`, organization: 'Example newsroom', consent: true, ...fields } });

let server;
let rows = [];
const requests = [];

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    requests.push({ path: url.pathname, authorization: req.headers.authorization, fields: url.searchParams.getAll('fields[]') });
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"type":"AUTHENTICATION_REQUIRED"}}'); return; }
    if (url.pathname !== `/v0/${BASE}/${TABLE}`) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"NOT_FOUND"}'); return; }
    // Two records per page, so the refresh follows an offset.
    const start = Number(url.searchParams.get('offset') || 0);
    const page = rows.slice(start, start + 2);
    const next = start + 2 < rows.length ? { offset: String(start + 2) } : {};
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ records: page, ...next }));
  });
  await new Promise((resolve) => server.listen(Number(origin.port), origin.hostname, resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  const db = adminDb();
  const pitches = await db.collection('session_pitches').where('source', '==', 'airtable').get();
  await Promise.all([...pitches.docs.map((doc) => doc.ref.delete()), db.doc('session_pitch_sources/airtable').delete(), db.doc('session_pitch_sync/airtable').delete()]);
});

test('an operator connects Airtable, refreshes, and sees a changed record marked in the queue', async ({ page }) => {
  page.on('pageerror', (err) => console.error('Browser error:', err.message));
  rows = [record(1), record(2), record(3, { consent: false })];
  await signIn(page, ADMIN_EMAIL);
  await page.goto('/admin/pitches');
  await expect(page.getByRole('heading', { name: 'Session pitches', exact: true })).toBeVisible();
  if (await page.getByRole('button', { name: 'End tour', exact: true }).isVisible()) await page.getByRole('button', { name: 'End tour', exact: true }).click();

  await page.getByText('Refresh pitches from Airtable', { exact: true }).click();
  await expect(page.getByText('No refresh has run yet.')).toBeVisible();
  await page.getByText('Connection settings', { exact: true }).click();
  await page.getByLabel('Base ID').fill(BASE);
  await page.getByLabel('Table ID or name').fill(TABLE);
  await page.getByLabel('Automatic refresh').selectOption('60');
  await page.getByRole('button', { name: 'Save Airtable settings' }).click();
  await expect(page.getByText('Airtable settings saved. Refresh to check the connection.')).toBeVisible();

  // Keyboard path: the refresh control takes focus and Enter runs it.
  await page.getByRole('button', { name: 'Refresh from Airtable' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Refresh complete: created 2, updated 0, unchanged 0, back in Airtable 0, skipped 1, flagged as removed 0\./)).toBeVisible();
  await expect(page.getByLabel('Airtable refresh status').getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Airtable pitch 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Airtable pitch 3', exact: true })).toHaveCount(0);
  expect(requests.length).toBe(2);
  expect(requests.every((r) => r.authorization === `Bearer ${token}`)).toBe(true);
  expect(requests[0].fields).toEqual(expect.arrayContaining(['email', 'title', 'description', 'consent']));

  const db = adminDb();
  const stored = await db.collection('session_pitches').where('source', '==', 'airtable').get();
  expect(stored.size).toBe(2);
  expect(stored.docs.every((doc) => doc.data().status === 'new')).toBe(true);
  expect((await db.collection('admin_logs').where('action', '==', 'refreshAirtablePitches').get()).size).toBeGreaterThan(0);

  // The submitter edits pitch 1 in Airtable, and pitch 2 leaves the view.
  // A manual refresh waits one minute; move the last run back instead.
  rows = [record(1, { title: 'Airtable pitch 1, revised' }), record(3, { consent: false })];
  const status = (await db.doc('session_pitch_sync/airtable').get()).data();
  await db.doc('session_pitch_sync/airtable').update({ running: null, lastRun: { ...status.lastRun, startedAt: new Date(Date.now() - 2 * 60 * 1000) } });
  await page.getByRole('button', { name: 'Refresh from Airtable' }).click();
  await expect(page.getByText(/Refresh complete: created 0, updated 1, unchanged 0, back in Airtable 0, skipped 1, flagged as removed 1\./)).toBeVisible();
  const revised = page.getByRole('button', { name: 'Airtable pitch 1, revised', exact: true }).locator('xpath=ancestor::li[1]');
  await expect(revised.getByText('Updated in Airtable')).toBeVisible();
  const removed = page.getByRole('button', { name: 'Airtable pitch 2', exact: true }).locator('xpath=ancestor::li[1]');
  await expect(removed.getByText('Removed from Airtable')).toBeVisible();
  await page.getByRole('button', { name: 'Airtable pitch 1, revised', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Airtable changes' })).toContainText('The submitter changed title');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await db.collection('session_pitches').where('source', '==', 'airtable').get()).size).toBe(2);
});
