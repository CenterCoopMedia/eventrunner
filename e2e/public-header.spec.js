// Hosted rendering proof for #944. The baseline loads the PR base's real
// Header and CSS; both sources use the same fixture, fonts and viewports.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'apps/web/src');
const EVIDENCE = path.join(ROOT, 'test-results/admin-visual-evidence');
const NAME = '2027 NC News & Information Summit';
const WIDTHS = [390, 768, 1280, 1920];
let server;
let origin;
let base;

test.beforeAll(async () => {
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  base = event?.pull_request?.base?.sha;
  const baseline = new Map();
  if (base) {
    for (const name of ['components/Header.jsx', 'index.css']) {
      baseline.set(`${SOURCE}/${name}?header-before`, execFileSync('git', ['show', `${base}:apps/web/src/${name}`], { encoding: 'utf8' }));
    }
  }
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { default: tailwindcss } = await import('tailwindcss');
  const { default: autoprefixer } = await import('autoprefixer');
  const { default: tailwind } = await import('../apps/web/tailwind.config.js');
  server = await createServer({
    configFile: false, root: path.join(ROOT, 'e2e/fixtures/public-header'),
    publicDir: path.join(ROOT, 'apps/web/public'),
    plugins: [{ name: 'public-header-baseline', enforce: 'pre', load(id) { return baseline.get(id) ?? null; } }, react()],
    css: { postcss: { plugins: [tailwindcss({ ...tailwind,
      content: [`${SOURCE}/**/*.{js,jsx}`, `!${SOURCE}/**/*.test.{js,jsx}`] }), autoprefixer()] } },
    optimizeDeps: { include: ['react', 'react-dom/client', 'react-router', 'shared/theme', 'shared/time'] },
    define: { 'globalThis.HEADER_SOURCE': JSON.stringify(SOURCE) },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [ROOT] } },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await fs.mkdir(EVIDENCE, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

for (const variant of ['standard', 'masthead', 'compact', 'minimal']) {
  for (const logo of ['wide', 'square', 'none']) {
    test(`${variant} header keeps words intact with ${logo} logo`, async ({ page }, testInfo) => {
      await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const metrics = [];
      for (const source of base ? ['before', 'after'] : ['after']) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${origin}/?variant=${variant}&logo=${logo}&source=${source}`);
          const home = page.getByRole('link', { name: NAME, exact: true });
          await expect(home).toBeVisible();
          await expect(home).toHaveAttribute('href', '/');
          await page.evaluate(() => globalThis.document.fonts.ready);
          await page.locator('header img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
          // Read the structured tree before checking focus or taking evidence.
          const snapshot = await page.locator('header').ariaSnapshot();
          expect(snapshot).toContain(NAME);
          await home.focus();
          await expect(home).toBeFocused();
          if (width === 390) await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
          const measured = await page.locator('header').evaluate((header) => {
            const title = header.querySelector('.site-header-title');
            const link = header.querySelector('a');
            const box = title?.getBoundingClientRect();
            const style = title && globalThis.getComputedStyle(title);
            const words = [];
            if (title && style.position !== 'absolute') {
              const text = title.firstChild;
              for (const match of text.textContent.matchAll(/\S+/g)) {
                const range = globalThis.document.createRange();
                range.setStart(text, match.index);
                range.setEnd(text, match.index + match[0].length);
                words.push({ word: match[0], lines: range.getClientRects().length });
              }
            }
            return {
              width: globalThis.innerWidth,
              scrollWidth: globalThis.document.documentElement.scrollWidth,
              linkRight: link.getBoundingClientRect().right,
              titleHeight: box?.height ?? 0,
              lineHeight: style ? parseFloat(style.lineHeight) : 0,
              screenReaderOnly: style?.position === 'absolute', words,
            };
          });
          metrics.push({ source, width, ...measured });
          await page.screenshot({ path: path.join(EVIDENCE, `public-header--${source}--${variant}--${logo}--${width}.png`), animations: 'disabled' });
          if (source === 'before') continue;
          expect(measured.scrollWidth).toBeLessThanOrEqual(width);
          expect(measured.linkRight).toBeLessThanOrEqual(width);
          if (variant !== 'minimal' || logo === 'none') {
            expect(measured.screenReaderOnly).toBe(width === 390 && logo !== 'none');
            if (!measured.screenReaderOnly) {
              expect(measured.titleHeight).toBeGreaterThan(0);
              expect(measured.titleHeight).toBeLessThanOrEqual(measured.lineHeight * 2 + 1);
              expect(measured.words.every((word) => word.lines === 1), JSON.stringify(measured.words)).toBe(true);
            }
          }
        }
      }
      await testInfo.attach('header-rendering', { body: JSON.stringify({ base, variant, logo, metrics }, null, 2), contentType: 'application/json' });
    });
  }
}
