// Hosted acceptance for #551. The before view uses the PR base's actual
// shared chrome inside the same new specimen. Presentation moves are shared
// with the real pages; no authenticated page or provider is mounted here.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

const ROOT = process.cwd();
const COMPONENTS = path.join(ROOT, 'apps/web/src/admin/components');
const EVIDENCE = path.join(ROOT, 'test-results/admin-visual-evidence');
const FAMILIES = ['materials', 'queue', 'figures', 'email', 'versions', 'pending', 'access', 'invoices', 'rich-text'];
let server;
let beforeOrigin;
let base;
const unexpectedRequests = new WeakMap();

test.use({ timezoneId: 'UTC' });
test.beforeAll(async () => {
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  base = event?.pull_request?.base?.sha;
  if (base) {
    const baseline = new Map(['adminChrome.jsx', 'AdminTableScroll.jsx'].map((file) => [path.join(COMPONENTS, file),
      execFileSync('git', ['show', `${base}:apps/web/src/admin/components/${file}`], { encoding: 'utf8' })]));
    const { createServer } = await import('vite');
    const { default: tailwindcss } = await import('tailwindcss');
    const { default: autoprefixer } = await import('autoprefixer');
    const { default: tailwind } = await import('../apps/web/tailwind.config.js');
    const { default: configureWeb } = await import('../apps/web/vite.config.js');
    const webConfig = configureWeb({ command: 'serve', mode: 'development', isSsrBuild: false });
    server = await createServer({ ...webConfig, configFile: false, root: path.join(ROOT, 'apps/web'), base: '/',
      plugins: [{ name: 'admin-specimen-base-presentation', enforce: 'pre', load(id) { return baseline.get(id.split('?')[0]) ?? null; } }, ...webConfig.plugins],
      css: { postcss: { plugins: [tailwindcss({ ...tailwind,
        content: [path.join(ROOT, 'apps/web/index.html'), path.join(ROOT, 'apps/web/src/**/*.{js,jsx}'), `!${path.join(ROOT, 'apps/web/src/**/*.test.{js,jsx}')}`],
      }), autoprefixer()] } },
      optimizeDeps: webConfig.optimizeDeps,
      server: { ...webConfig.server, host: '127.0.0.1', port: 0, strictPort: false },
    });
    await server.listen();
    beforeOrigin = `http://127.0.0.1:${server.httpServer.address().port}`;
  }
  await fs.mkdir(EVIDENCE, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });
test.afterEach(async ({ page }) => { expect(unexpectedRequests.get(page) ?? []).toEqual([]); });

async function openSpecimen(page, url) {
  if (!unexpectedRequests.has(page)) {
    const unexpected = [];
    unexpectedRequests.set(page, unexpected);
    const allowed = new Set([new URL(test.info().project.use.baseURL).origin, ...(beforeOrigin ? [beforeOrigin] : [])]);
    await page.route('**/*', (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (!allowed.has(target.origin) || request.method() !== 'GET' || target.pathname.startsWith('/api/')
        || /\/(?:google\.firestore|identitytoolkit|v1\/projects)|:5001\//.test(target.href)) {
        unexpected.push(`${request.method()} ${target.origin}${target.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
  }
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'Admin devices' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Example introduction' })).toBeVisible();
  await page.evaluate(() => globalThis.document.fonts.ready);
  expect(await page.locator('main').ariaSnapshot()).toContain('Admin devices');
}

for (const width of [1440, 390]) {
  for (const mode of ['light', 'dark']) {
    test(`all Admin families at ${width} in ${mode}`, async ({ page, baseURL }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const metrics = [];
      for (const source of beforeOrigin ? ['before', 'after'] : ['after']) {
        const origin = source === 'before' ? beforeOrigin : baseURL;
        await openSpecimen(page, `${origin}/specimen/admin?mode=${mode}`);
        for (const id of FAMILIES) await expect(page.locator(`[data-admin-specimen="${id}"]`)).toBeVisible();
        await expect(page.locator('meta[name="robots"][data-specimen="true"]')).toHaveAttribute('content', 'noindex');
        const measurement = await page.locator('main').evaluate((main) => {
          const live = main.querySelector('[data-record-state="live"]');
          const draft = main.querySelector('[data-record-state="draft"]');
          const dirty = main.querySelector('[data-record-state="dirty"]');
          const header = main.querySelector('.admin-job-line');
          const description = header.nextElementSibling;
          const style = (node) => globalThis.getComputedStyle(node);
          const bounds = (node) => {
            const rect = node.getBoundingClientRect();
            return { width: rect.width, right: rect.right, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
          };
          const escapesViewport = (node) => {
            if (node.getBoundingClientRect().right <= globalThis.innerWidth) return false;
            for (let ancestor = node.parentElement; ancestor && ancestor !== main; ancestor = ancestor.parentElement) {
              if (['auto', 'scroll', 'hidden', 'clip'].includes(style(ancestor).overflowX)
                && (style(node).position !== 'absolute' || ancestor.contains(node.offsetParent))) return false;
            }
            return true;
          };
          return {
            mode: globalThis.document.documentElement.dataset.mode,
            viewport: globalThis.innerWidth, scrollWidth: globalThis.document.documentElement.scrollWidth,
            liveWeight: style(live).fontWeight, draftWeight: style(draft).fontWeight, dirtyWeight: style(dirty).fontWeight,
            descriptionWrap: style(description).textWrapStyle,
            font: style(main).fontFamily, dataFont: style(main.querySelector('.font-admin-data')).fontFamily,
            descriptionHeight: description.getBoundingClientRect().height,
            descriptionWidth: description.getBoundingClientRect().width,
            families: [...main.querySelectorAll('[data-admin-specimen]')].map((node) => ({ family: node.dataset.adminSpecimen, ...bounds(node) })),
            overflow: [...globalThis.document.querySelectorAll('body *')].filter(escapesViewport).slice(0, 20).map((node) => ({
              family: node.closest('[data-admin-specimen]')?.dataset.adminSpecimen ?? 'document',
              element: node.tagName, className: node.getAttribute('class'), ...bounds(node),
            })),
          };
        });
        metrics.push({ source, ...measurement });
        await fs.writeFile(path.join(EVIDENCE, `admin-specimen--${mode}--${width}.json`), JSON.stringify({
          base, comparison: 'Base shared presentation and PR shared presentation in the same new synthetic specimen', width, mode, metrics,
        }, null, 2));
        await page.screenshot({ path: path.join(EVIDENCE, `admin-specimen--${source}--${mode}--${width}.png`), fullPage: true, animations: 'disabled' });
        if (source === 'before') {
          expect(measurement.liveWeight).toBe('600');
          expect(measurement.descriptionWrap).not.toBe('pretty');
          continue;
        }
        expect(measurement.mode).toBe(mode);
        expect(measurement.liveWeight).toBe('400');
        expect(measurement.draftWeight).toBe('600');
        expect(measurement.dirtyWeight).toBe('600');
        expect(measurement.descriptionWrap).toBe('pretty');
        expect(measurement.font).toContain('Source Sans 3');
        expect(measurement.dataFont).toContain('IBM Plex Mono');
        expect(measurement.scrollWidth).toBeLessThanOrEqual(width);
        for (const id of FAMILIES) {
          await page.locator(`[data-admin-specimen="${id}"]`).screenshot({ path: path.join(EVIDENCE, `admin-specimen--${mode}--${width}--${id}.png`), animations: 'disabled' });
        }
        await page.getByRole('button', { name: 'Show short description' }).click();
        await expect(page.getByText('Real Admin devices with synthetic data and local example actions.')).toBeVisible();
        if (width === 390) {
          const invoices = page.getByRole('region', { name: 'Invoices, newest first', exact: true });
          await invoices.focus();
          await page.keyboard.press('ArrowRight');
          await expect.poll(() => invoices.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
          expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
      }
      const evidence = JSON.stringify({ base, comparison: 'Base shared presentation and PR shared presentation in the same new synthetic specimen', width, mode, metrics }, null, 2);
      await fs.writeFile(path.join(EVIDENCE, `admin-specimen--${mode}--${width}.json`), evidence);
      await testInfo.attach('admin-specimen-geometry', { body: evidence, contentType: 'application/json' });
    });
  }
}

test('table sort, partial selection, filters, busy archive and result keep their real controls', async ({ page }) => {
  await openSpecimen(page, '/specimen/admin');
  const specimen = page.locator('[data-admin-specimen="materials"]');
  const material = specimen.getByRole('button', { name: /^Material/ });
  await material.focus();
  await page.keyboard.press('Enter');
  await expect(material.locator('..')).toHaveAttribute('aria-sort', 'ascending');
  await page.keyboard.press('Enter');
  await expect(material.locator('..')).toHaveAttribute('aria-sort', 'descending');
  await specimen.getByRole('checkbox', { name: 'Select Dataset.csv', exact: true }).check();
  const all = specimen.getByRole('checkbox', { name: 'Select all files shown' });
  expect(await all.evaluate((node) => node.indeterminate)).toBe(true);
  await all.check();
  await expect(specimen.getByRole('status')).toHaveText('2 files selected');
  await specimen.getByLabel('Review', { exact: true }).selectOption('pending');
  await expect(specimen.getByRole('status')).toHaveText('No files selected');
  await specimen.getByRole('checkbox', { name: 'Select Dataset.csv', exact: true }).check();
  const archive = specimen.getByRole('button', { name: /^(Download as archive|Preparing archive…)/ });
  await archive.focus();
  await page.keyboard.press('Enter');
  await expect(archive).toBeFocused();
  await expect(archive).toHaveAttribute('aria-busy', 'true');
  await specimen.getByRole('button', { name: 'Finish archive example' }).click();
  await expect(specimen.getByText('The example archive is ready.')).toBeVisible();
  await specimen.getByLabel('Materials example state').selectOption('error');
  await specimen.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(specimen.getByRole('region', { name: 'Materials', exact: true })).toBeVisible();
});

test('email preview stays isolated and version disclosures show stored text', async ({ page }) => {
  await openSpecimen(page, '/specimen/admin');
  const log = page.locator('[data-admin-specimen="email"]');
  const preview = log.locator('iframe');
  await expect(preview).toHaveAttribute('sandbox', '');
  await expect(preview).toHaveAttribute('referrerpolicy', 'no-referrer');
  const previewDocument = preview.contentFrame();
  await expect(previewDocument.locator('a[href], area[href]')).toHaveCount(0);
  await expect(previewDocument.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /default-src 'none'; img-src data:/);
  // Stored images remain in the document. CSP blocks their remote fetch;
  // the page request guard also fails if a request escapes that boundary.
  await expect(previewDocument.getByAltText('Example image')).toHaveAttribute('src', 'https://example.test/image.png');
  expect(await previewDocument.getByAltText('Example image').evaluate((image) => image.naturalWidth)).toBe(0);
  await log.getByLabel('Email preview example state').selectOption('error');
  await log.getByRole('button', { name: 'Retry preview' }).click();
  await expect(log.locator('iframe')).toBeVisible();
  await log.getByLabel('Email preview example state').selectOption('private');
  await expect(log.getByText('This message is private because it contains a sign-in code or invitation link.')).toBeVisible();
  await expect(log.locator('iframe')).toHaveCount(0);
  const versions = page.locator('[data-admin-specimen="versions"]');
  const disclosure = versions.getByText(/^Show all \d+ characters$/);
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure.locator('..')).toHaveAttribute('open', '');
  await expect(versions.getByText('First published.', { exact: true })).toBeVisible();
});

test('limited rich-text formatting restores focus from its link panel', async ({ page }) => {
  await openSpecimen(page, '/specimen/admin');
  const specimen = page.locator('[data-admin-specimen="rich-text"]');
  const editor = specimen.getByRole('textbox', { name: 'Example introduction', exact: true });
  await editor.fill('An example introduction');
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await specimen.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('An example introduction');
  const link = specimen.getByRole('button', { name: 'Link', exact: true });
  await link.click();
  const address = specimen.getByRole('textbox', { name: 'Link address', exact: true });
  await expect(address).toBeFocused();
  await address.fill('javascript:example');
  await specimen.getByRole('button', { name: 'Apply link' }).click();
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await address.press('Escape');
  await expect(link).toBeFocused();
  await expect(address).toHaveCount(0);
  await expect(specimen.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
});

test('publish, access and pending examples cover held, failed, empty and completed states', async ({ page }) => {
  await openSpecimen(page, '/specimen/admin');
  const queue = page.locator('[data-admin-specimen="queue"]');
  await queue.getByLabel('Publish queue example state').selectOption('loading');
  await expect(queue.getByText('Loading publish runs…', { exact: true })).toBeVisible();
  await queue.getByLabel('Publish queue example state').selectOption('empty');
  await expect(queue.getByRole('heading', { name: 'No recent publishes' })).toBeVisible();
  await queue.getByLabel('Publish queue example state').selectOption('error');
  await queue.getByRole('button', { name: 'Try again', exact: true }).click();
  const resume = queue.getByRole('button', { name: /^(Resume publish|Resuming…)/ });
  await resume.focus();
  await page.keyboard.press('Enter');
  await expect(resume).toBeFocused();
  await expect(resume).toHaveAttribute('aria-busy', 'true');
  await queue.getByRole('button', { name: 'Show publish error' }).click();
  await expect(queue.getByText('The example publish stopped. Try again.')).toBeVisible();
  await resume.click();
  await queue.getByRole('button', { name: 'Finish publish example' }).click();
  await expect(queue.getByText('3 of 3 published.', { exact: true })).toHaveCount(2);

  const access = page.locator('[data-admin-specimen="access"]');
  await access.getByLabel('Access list example state').selectOption('loading');
  await expect(access.getByText('Loading admin access…', { exact: true })).toBeVisible();
  await access.getByLabel('Access list example state').selectOption('error');
  await access.getByRole('button', { name: 'Try again', exact: true }).click();
  await access.getByLabel('Access list example state').selectOption('busy');
  await expect(access.getByRole('button', { name: 'Remove access for operator@example.test', exact: true })).toBeDisabled();
  await access.getByLabel('Access list example state').selectOption('ready');
  await access.getByRole('button', { name: 'Send sign-in instructions to support@example.test', exact: true }).click();
  await expect(access.getByText(/Example request for support@example\.test:/)).toBeVisible();
  await access.getByLabel('Access list example state').selectOption('empty');
  await expect(access.getByRole('heading', { name: 'No admin accounts' })).toBeVisible();

  const pending = page.locator('[data-admin-specimen="pending"]');
  await pending.getByLabel('Pending count example state').selectOption('single');
  const banner = pending.getByRole('complementary', { name: 'Unpublished changes' });
  await expect(banner).toHaveAttribute('data-pending-total', '1');
  await expect(banner).not.toHaveAttribute('aria-live');
  await pending.getByLabel('Pending count example state').selectOption('error');
  await expect(banner).not.toHaveAttribute('data-pending-total');
  await expect(banner.getByText('We could not count the unpublished changes. We will try again.')).toBeVisible();
});

test('invoice fields use real arithmetic, errors, row controls and busy disabling', async ({ page }) => {
  await openSpecimen(page, '/specimen/admin');
  const invoice = page.locator('[data-admin-specimen="invoices"]');
  await expect(invoice.getByTestId('invoice-total')).toContainText('Total: $245.00');
  await invoice.getByLabel('Line 1 quantity', { exact: true }).fill('3');
  await expect(invoice.getByTestId('invoice-total')).toContainText('Total: $370.00');
  await invoice.getByRole('button', { name: 'Add a line', exact: true }).click();
  await invoice.getByLabel('Line 2 description', { exact: true }).fill('Example extra');
  await invoice.getByLabel('Line 2 unit price', { exact: true }).fill('5.00');
  await expect(invoice.getByTestId('invoice-total')).toContainText('Total: $375.00');
  await invoice.getByLabel('Invoices example state').selectOption('busy');
  await expect(invoice.getByLabel('Name to bill', { exact: true })).toBeDisabled();
  await invoice.getByLabel('Invoices example state').selectOption('invalid');
  await expect(invoice.getByLabel('Name to bill', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await invoice.getByLabel('Name to bill', { exact: true }).fill('Example updated name');
  await expect(invoice.getByLabel('Name to bill', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');
  await invoice.getByLabel('Invoices example state').selectOption('error');
  await invoice.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(invoice.getByRole('table', { name: 'Invoices, newest first' })).toBeVisible();
});

test('the public book contains an interactive separate document and keeps its own style', async ({ page }) => {
  await page.goto('/specimen');
  await expect(page.getByRole('heading', { level: 2, name: 'Admin devices' })).toBeVisible();
  const frame = page.getByTitle('Interactive Admin device specimens', { exact: true });
  await frame.scrollIntoViewIfNeeded();
  await expect(frame.contentFrame().getByRole('heading', { level: 1, name: 'Admin devices' })).toBeVisible();
  expect(await page.locator('main').ariaSnapshot()).toContain('Admin devices');
  await expect(page.locator('.admin-room')).toHaveCount(0);
  const parentMode = await page.locator('html').getAttribute('data-mode');
  await expect(frame).not.toHaveAttribute('tabindex', '-1');
  await expect(frame).not.toHaveAttribute('inert', '');
  await frame.contentFrame().getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(frame.contentFrame().locator('html')).toHaveAttribute('data-mode', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-mode', parentMode);
});
