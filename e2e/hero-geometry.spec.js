// Event hero geometry in every site style, mode and width (#345).
//
// The hero sets its copy beside a photograph from 640px up and above it on
// phones. The copy column ran onto the photograph in every style (#345),
// and no check measured what a reader sees. This spec measures the rendered
// glyph boxes on Home and the Program page, not the CSS, so a later token
// change that moves the words onto the picture fails here.
//
// It drives the real public Home page against the seeded emulators. The
// demo build is not used: its Newsroom style is the NC Local historical
// composition, and the shared Newsroom hero is the one #345 is about.
/* global document, NodeFilter */
import { test, expect } from '@playwright/test';
import { adminDb } from './helpers.mjs';

const THEMES = ['civic', 'newsroom', 'broadsheet', 'atlas', 'field-guide', 'zine'];
const MODES = ['light', 'dark'];
const WIDTHS = [320, 640, 768, 1024, 1280, 1440, 1920];
// The phone layout stacks the photograph under the copy below this width.
const SIDE_BY_SIDE_MIN = 640;
const LONG_TITLE = 'The Fifteenth Annual Regional Convening of Community Newsrooms, Public Media Partners and Neighborhood Reporters';

/** Glyph boxes of every text run and control in the copy, and the boxes they sit in. */
async function measureHero(page) {
  return page.evaluate(() => {
    const hero = document.querySelector('.event-hero');
    const copy = hero.querySelector('.event-hero__copy');
    const art = hero.querySelector('.event-hero__art');
    const boxes = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0) boxes.push({ text: node.textContent.trim().slice(0, 40), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      }
    }
    for (const control of copy.querySelectorAll('a, button')) {
      const rect = control.getBoundingClientRect();
      if (rect.width > 0) boxes.push({ text: control.textContent.trim().slice(0, 40), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    }
    const heroRect = hero.getBoundingClientRect();
    const artRect = art ? art.getBoundingClientRect() : null;
    return {
      illustrated: hero.classList.contains('event-hero--illustrated'),
      hero: { left: heroRect.left, right: heroRect.right },
      art: artRect ? { left: artRect.left, top: artRect.top } : null,
      boxes,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

function round(value) {
  return Math.round(value * 10) / 10;
}

/** Every way the copy breaks the contract at one width, as readable lines. */
function heroFaults(width, metrics) {
  const faults = [];
  if (metrics.scrollWidth > metrics.clientWidth) faults.push(`page scrolls sideways (${metrics.scrollWidth}px)`);
  expect(metrics.boxes.length, 'the hero copy has text').toBeGreaterThan(0);
  const textBottom = Math.max(...metrics.boxes.map((box) => box.bottom));
  const sideBySide = metrics.illustrated && width >= SIDE_BY_SIDE_MIN;
  if (metrics.illustrated && sideBySide) {
    // #345: no word or control sits on the photograph. Name the line that
    // reaches furthest onto it.
    const furthest = metrics.boxes.reduce((last, box) => (box.right > last.right ? box : last));
    if (furthest.right > metrics.art.left) {
      faults.push(`"${furthest.text}" runs ${round(furthest.right - metrics.art.left)}px onto the photograph`);
    }
  } else if (metrics.illustrated && metrics.art.top < textBottom) {
    faults.push(`the phone photograph starts ${round(textBottom - metrics.art.top)}px above the end of the copy`);
  }
  return faults;
}

test('hero copy stays off the photograph in every style, mode and width', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const db = adminDb();
  const themeRef = db.doc('config/theme');
  const imageRef = db.collection('cmsContent').doc('hero__image');
  const titleRef = db.collection('cmsContent').doc('hero__title');
  const [themeSnap, imageSnap, titleSnap] = await Promise.all([themeRef.get(), imageRef.get(), titleRef.get()]);
  const savedTheme = themeSnap.exists ? themeSnap.data() : null;
  const savedImage = imageSnap.exists ? imageSnap.data() : null;
  const savedTitle = titleSnap.exists ? titleSnap.data() : null;
  const report = [];
  const faults = [];

  try {
    for (const theme of THEMES) {
      await imageRef.set({
        section: 'hero', field: 'image', blockType: 'image', url: `/hero/${theme}.webp`,
        alt: 'A wide photograph for the event hero.', visible: true, order: 2,
      });
      for (const mode of MODES) {
        await themeRef.set({ ...savedTheme, preset: theme, mode });
        for (const copy of ['normal', 'long']) {
          if (copy === 'long') {
            await titleRef.set({ ...savedTitle, section: 'hero', field: 'title', blockType: 'text', value: LONG_TITLE, visible: true });
          } else if (savedTitle) {
            await titleRef.set(savedTitle);
          }
          for (const route of ['/', '/schedule']) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.goto(route);
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
            await expect(page.locator('.event-hero__title')).toBeVisible();
            if (route === '/') {
              await expect(page.locator('.event-hero--illustrated .event-hero__art')).toBeVisible();
              if (copy === 'long') await expect(page.locator('.event-hero__title')).toHaveText(LONG_TITLE);
            }
            await page.evaluate(() => document.fonts.ready);
            for (const width of WIDTHS) {
              await page.setViewportSize({ width, height: 900 });
              const found = heroFaults(width, await measureHero(page));
              report.push({ route, theme, mode, copy, width, faults: found });
              for (const fault of found) faults.push(`${route} ${theme} ${mode} ${copy} ${width}px: ${fault}`);
            }
          }
        }
      }
    }
  } finally {
    if (savedTheme) await themeRef.set(savedTheme);
    else await themeRef.delete();
    if (savedImage) await imageRef.set(savedImage);
    else await imageRef.delete();
    if (savedTitle) await titleRef.set(savedTitle);
    else await titleRef.delete();
  }

  await testInfo.attach('hero-geometry.json', {
    body: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    contentType: 'application/json',
  });
  expect(faults, `${faults.length} hero geometry faults`).toEqual([]);
});
