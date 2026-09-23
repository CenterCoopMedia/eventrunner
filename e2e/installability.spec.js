// Browser installability with the default mark (#218).
//
// The dev server serves apps/web/public as it is: the fallback manifest
// and the two committed placeholder icons. The fallback is, field for
// field, what the manifest builder writes for a deployment with the default
// mark (scripts/lib/site-manifest.test.cjs), and the icons are the bytes
// both publish scripts copy (scripts/lib/app-icons.test.cjs). So Chrome's
// own check here also covers a deployed default-mark site.
//
// Each test launches its own Chromium with a fresh profile on disk: the
// default Playwright context is off the record, which Chrome's install
// check may refuse, and `channel: 'chromium'` runs the full browser rather
// than the headless shell, which may lack the CDP method.
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ICONS = ['branding/app-icon-192.png', 'branding/app-icon-512.png'];

/** Open `/` in a fresh persistent profile and ask Chrome about installing it. */
async function checkInstallability(baseURL, { blockIcons = false } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'installability-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, baseURL });
  try {
    if (blockIcons) {
      await context.route(/\/branding\/app-icon-\d+\.png$/, (route) => route.fulfill({ status: 404, body: '' }));
    }
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto('/');
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    const icons = [];
    for (const icon of ICONS) {
      const response = await page.request.get(new URL(icon, manifest.url).href);
      icons.push({ icon, status: response.status(), type: response.headers()['content-type'] });
    }
    return { manifest, installabilityErrors, icons };
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

test('a site with the default mark passes the browser installability check', async ({ baseURL }) => {
  const { manifest, installabilityErrors, icons } = await checkInstallability(baseURL);

  // A non-critical parser note (Chrome may comment on `any maskable`) does
  // not fail the check; it is attached to the run so it can be quoted.
  if (manifest.errors.length > 0) {
    test.info().annotations.push({ type: 'manifest parser notes', description: JSON.stringify(manifest.errors) });
  }
  expect(manifest.errors.filter((error) => error.critical)).toEqual([]);
  expect(installabilityErrors).toEqual([]);

  expect(JSON.parse(manifest.data).icons.map((icon) => [icon.src, icon.sizes, icon.type])).toEqual([
    ['branding/app-icon-192.png', '192x192', 'image/png'],
    ['branding/app-icon-512.png', '512x512', 'image/png'],
  ]);
  for (const icon of icons) {
    expect(icon.status, icon.icon).toBe(200);
    expect(icon.type, icon.icon).toMatch(/^image\/png/);
  }
});

test('without the two raster icons the same check fails, so the pass is theirs', async ({ baseURL }) => {
  const { installabilityErrors } = await checkInstallability(baseURL, { blockIcons: true });
  expect(installabilityErrors.map((error) => error.errorId)).toContain('no-acceptable-icon');
});
