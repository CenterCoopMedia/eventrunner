import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const MOTIFS = [
  ['botanical', 'section-mark'],
  ['botanical', 'nameplate-mark'],
  ['botanical', 'divider'],
  ['botanical', 'empty-state'],
  ['cartographic', 'section-mark'],
];
const EVIDENCE = path.resolve('test-results/admin-visual-evidence');

// Keep the real specimen layout for the geometry check and use the documented
// live slot heights for the close-up captures.
const LIVE_SLOT_SIZES = `
  .specimen-motif-row li:has([data-motif-slot="divider"]),
  .specimen-motif-row li:has([data-motif-slot="empty-state"]) {
    flex: 0 0 100%;
    flex-direction: column;
    align-items: flex-start;
  }
  .specimen-motif-row [data-motif-slot="section-mark"] { width: 20px; height: 20px; }
  .specimen-motif-row [data-motif-slot="nameplate-mark"] { width: 24px; height: 24px; }
  .specimen-motif-row [data-motif-slot="divider"] { width: min(100%, 320px); height: 32px; }
  .specimen-motif-row [data-motif-slot="empty-state"] { width: min(100%, 320px); height: 128px; }
`;

function assetPath(set, slot) {
  return `/motifs/${set}/${slot}.svg`;
}

async function readBaseAssets() {
  if (!process.env.GITHUB_EVENT_PATH) return new Map();
  const { pull_request: pullRequest } = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!pullRequest?.base?.sha) return new Map();
  return new Map(MOTIFS.map(([set, slot]) => {
    const asset = assetPath(set, slot);
    const contents = execFileSync('git', ['show', `${pullRequest.base.sha}:apps/web/public${asset}`]);
    return [asset, contents];
  }));
}

async function geometry(section) {
  return section.evaluate((element) => {
    const box = (node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y: y + globalThis.scrollY, width, height };
    };
    const document = element.ownerDocument;
    return {
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      section: box(element),
      marks: [...element.querySelectorAll('[data-motif-slot]')].map(box),
    };
  });
}

for (const width of [320, 1280]) {
  test(`motif artwork keeps its boxes and page layout at ${width}px`, async ({ page }) => {
    const baseline = await readBaseAssets();
    const serveBase = (route) => {
      const asset = baseline.get(new URL(route.request().url()).pathname);
      return asset ? route.fulfill({ contentType: 'image/svg+xml', body: asset }) : route.continue();
    };
    const variants = baseline.size ? ['before', 'after'] : ['after'];
    await fs.mkdir(EVIDENCE, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let before;
    for (const variant of variants) {
      if (variant === 'before') await page.route('**/motifs/**/*.svg', serveBase);
      await page.goto('/specimen');
      const section = page.getByRole('region', { name: 'Illustrations', exact: true });
      await expect(section.getByRole('heading', { name: 'Illustrations' })).toBeVisible();
      await page.evaluate(() => globalThis.document.fonts.ready);
      const original = await geometry(section);

      await page.addStyleTag({ content: LIVE_SLOT_SIZES });
      for (const [set, slot] of MOTIFS) {
        const mark = section.locator(`[data-motif-set="${set}"] [data-motif-slot="${slot}"]`);
        const asset = assetPath(set, slot);
        await expect(mark).toBeVisible();
        await expect(mark).toHaveAttribute('aria-hidden', 'true');
        await expect(mark).toHaveCSS('mask-image', new RegExp(`${asset}"?\\)$`));
        await mark.evaluate(async (node) => {
          const url = globalThis.getComputedStyle(node).maskImage.slice(4, -1).replaceAll('"', '');
          const image = new globalThis.Image();
          image.src = url;
          await image.decode();
        });
        await mark.locator('..').screenshot({
          path: path.join(EVIDENCE, `motif-${set}-${slot}-${width}-${variant}.png`),
          animations: 'disabled',
        });
      }

      const measured = { original, liveSlots: await geometry(section) };
      if (variant === 'before') {
        before = measured;
        await page.unroute('**/motifs/**/*.svg', serveBase);
      } else if (before) {
        expect(measured).toEqual(before);
      }
    }
  });
}
