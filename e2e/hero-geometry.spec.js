// Event hero geometry in every site style, mode and width (#345, #478).
//
// The hero sets its copy beside a photograph from 640px up and above it on
// phones. Two defects reached the public page because no check measured
// what a reader sees: the copy column ran onto the photograph (#345), and
// the copy started at the hero's coloured left edge with no inner inset
// (#478). This spec measures the rendered glyph boxes on Home and the
// Program page, not the CSS, so a later token change that moves the words
// onto the picture or against the edge fails here.
//
// It drives the real public Home page against the seeded emulators. The
// demo build is not used: its Newsroom style is the NC Local historical
// composition, and the shared Newsroom hero is the one #345 is about.
/* global document, NodeFilter */
import { test, expect } from '@playwright/test';
import { adminDb } from './helpers.mjs';

const THEMES = ['civic', 'newsroom', 'broadsheet', 'atlas', 'field-guide', 'zine'];
const MODES = ['light', 'dark'];
const WIDTHS = [320, 360, 375, 640, 768, 1024, 1280, 1440, 1920];
// The phone layout stacks the photograph under the copy below this width.
const SIDE_BY_SIDE_MIN = 640;
// The smallest inner inset the copy may have from the hero's edge.
const MIN_INSET = 12;
const LONG_TITLE = 'The Fifteenth Annual Regional Convening of Community Newsrooms, Public Media Partners and Neighborhood Reporters';
// A CMS action label with no space in it, longer than any copy column.
const LONG_ACTION = 'Registrationforthefullprogrammeofsessionsworkshopsandreceptions';
// The touch target every action keeps (interface guidelines, Accessibility).
const TOUCH_TARGET = 44;

/** Glyph boxes of every text run and control in the copy, and the boxes they sit in. */
async function measureHero(page) {
  return page.evaluate(() => {
    const hero = document.querySelector('.event-hero');
    const copy = hero.querySelector('.event-hero__copy');
    const art = hero.querySelector('.event-hero__art');
    const boxes = [];
    const brokenWords = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0) boxes.push({ text: node.textContent.trim().slice(0, 40), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      }
      // A word whose letters land on two lines was broken inside the word.
      for (const match of node.textContent.matchAll(/\S+/g)) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)));
        if (lines.size > 1 && !node.parentElement.closest('a, button')) brokenWords.push(match[0]);
      }
    }
    const controls = [];
    for (const control of copy.querySelectorAll('a, button')) {
      const rect = control.getBoundingClientRect();
      if (rect.width > 0) {
        boxes.push({ text: control.textContent.trim().slice(0, 40), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
        controls.push({ text: control.textContent.trim().slice(0, 40), height: rect.height });
      }
    }
    const heroRect = hero.getBoundingClientRect();
    const copyRect = copy.getBoundingClientRect();
    const artRect = art ? art.getBoundingClientRect() : null;
    return {
      illustrated: hero.classList.contains('event-hero--illustrated'),
      hero: { left: heroRect.left, right: heroRect.right },
      copy: { right: copyRect.right },
      art: artRect ? { left: artRect.left, top: artRect.top } : null,
      boxes,
      controls,
      brokenWords,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

function round(value) {
  return Math.round(value * 10) / 10;
}

/** Every way the copy breaks the contract at one width, as readable lines. */
function heroFaults(width, metrics, copy) {
  const faults = [];
  // A narrower copy column must not break a word at an arbitrary letter.
  // The long stress title's longest word is wider than a 320px phone line in
  // most styles; that was already so before the column existed.
  if (metrics.brokenWords.length && (copy !== 'long' || width >= SIDE_BY_SIDE_MIN)) {
    faults.push(`breaks inside ${metrics.brokenWords.join(', ')}`);
  }
  if (metrics.scrollWidth > metrics.clientWidth) faults.push(`page scrolls sideways (${metrics.scrollWidth}px)`);
  expect(metrics.boxes.length, 'the hero copy has text').toBeGreaterThan(0);
  const textLeft = Math.min(...metrics.boxes.map((box) => box.left));
  const textRight = Math.max(...metrics.boxes.map((box) => box.right));
  const textBottom = Math.max(...metrics.boxes.map((box) => box.bottom));
  // #478: the copy keeps a visible inset from the hero's edge.
  if (textLeft - metrics.hero.left < MIN_INSET) {
    faults.push(`copy starts ${round(textLeft - metrics.hero.left)}px from the hero's left edge`);
  }
  // Nothing in the copy is cut off by the hero's own edge.
  if (textRight > metrics.hero.right + 0.5) {
    faults.push(`copy runs ${round(textRight - metrics.hero.right)}px past the hero's right edge`);
  }
  for (const control of metrics.controls) {
    if (control.height < TOUCH_TARGET - 0.5) faults.push(`"${control.text}" is ${round(control.height)}px tall`);
  }
  const sideBySide = metrics.illustrated && width >= SIDE_BY_SIDE_MIN;
  if (!sideBySide && metrics.hero.right - textRight < MIN_INSET) {
    faults.push(`copy ends ${round(metrics.hero.right - textRight)}px from the hero's right edge`);
  }
  if (metrics.illustrated && sideBySide) {
    // #345: no word or control sits on the photograph. Name the line that
    // reaches furthest onto it.
    const furthest = metrics.boxes.reduce((last, box) => (box.right > last.right ? box : last));
    if (furthest.right > metrics.art.left) {
      faults.push(`"${furthest.text}" runs ${round(furthest.right - metrics.art.left)}px onto the photograph`);
    }
    // The copy column ends where the photograph starts: no strip of band
    // between them, and no overlap.
    if (Math.abs(metrics.copy.right - metrics.art.left) > 1) {
      faults.push(`the copy column ends ${round(metrics.art.left - metrics.copy.right)}px before the photograph`);
    }
  } else if (metrics.illustrated && metrics.art.top < textBottom) {
    faults.push(`the phone photograph starts ${round(textBottom - metrics.art.top)}px above the end of the copy`);
  }
  return faults;
}

test('hero copy keeps its inset and stays off the photograph in every style, mode and width', async ({ page }, testInfo) => {
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
          } else {
            await titleRef.delete();
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
              const found = heroFaults(width, await measureHero(page), copy);
              report.push({ route, theme, mode, copy, width, faults: found });
              for (const fault of found) faults.push(`${route} ${theme} ${mode} ${copy} ${width}px: ${fault}`);
            }
          }
        }
      }
    }

    // A hero with no photograph is a coloured band: its copy needs the same
    // inset on both sides (#478).
    await imageRef.delete();
    if (savedTitle) await titleRef.set(savedTitle);
    else await titleRef.delete();
    for (const theme of THEMES) {
      for (const mode of MODES) {
        await themeRef.set({ ...savedTheme, preset: theme, mode });
        for (const route of ['/', '/schedule']) {
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.goto(route);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
          await expect(page.locator('.event-hero:not(.event-hero--illustrated) .event-hero__title')).toBeVisible();
          for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: 900 });
            const found = heroFaults(width, await measureHero(page), 'normal');
            report.push({ route, theme, mode, copy: 'no photograph', width, faults: found });
            for (const fault of found) faults.push(`${route} ${theme} ${mode} no photograph ${width}px: ${fault}`);
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

// Three edge cases from review: the NC Local composition, an action label
// with no space in it, and a reader whose root text size is 32px.
test('hero copy meets the photograph, long actions wrap, and large root text is not clipped', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const db = adminDb();
  const themeRef = db.doc('config/theme');
  const imageRef = db.collection('cmsContent').doc('hero__image');
  const actionRef = db.collection('cmsContent').doc('hero__geometry_long_action');
  const [themeSnap, imageSnap] = await Promise.all([themeRef.get(), imageRef.get()]);
  const savedTheme = themeSnap.exists ? themeSnap.data() : null;
  const savedImage = imageSnap.exists ? imageSnap.data() : null;
  const report = [];
  const faults = [];
  const record = (label, width, found) => {
    report.push({ label, width, faults: found });
    for (const fault of found) faults.push(`${label} ${width}px: ${fault}`);
  };

  try {
    // NC Local is the Newsroom style under a wrapper attribute that only the
    // read-only historical demo sets. Its own rule must end the copy where
    // the shared photograph starts, including hero widths below 704px.
    await imageRef.set({
      section: 'hero', field: 'image', blockType: 'image', url: '/hero/newsroom.webp',
      alt: 'A wide photograph for the event hero.', visible: true, order: 2,
    });
    await themeRef.set({ ...savedTheme, preset: 'newsroom', mode: 'light' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'newsroom');
    await expect(page.locator('.event-hero--illustrated .event-hero__art')).toBeVisible();
    await page.evaluate(() => document.querySelector('.page-surface').setAttribute('data-historical-demo', 'nclocal'));
    for (const width of [640, 680, 720, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      record('NC Local', width, heroFaults(width, await measureHero(page), 'normal'));
    }

    // A CMS action label with no space in it wraps inside its button, keeps
    // the touch target, and stays in the copy column.
    await actionRef.set({
      section: 'hero', field: 'geometry_long_action', blockType: 'cta', label: LONG_ACTION,
      url: '/schedule', style: 'primary', visible: true, order: 9,
    });
    for (const theme of THEMES) {
      await imageRef.set({
        section: 'hero', field: 'image', blockType: 'image', url: `/hero/${theme}.webp`,
        alt: 'A wide photograph for the event hero.', visible: true, order: 2,
      });
      await themeRef.set({ ...savedTheme, preset: theme, mode: 'light' });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.event-hero--illustrated .event-hero__art')).toBeVisible();
      await expect(page.getByRole('link', { name: LONG_ACTION })).toBeVisible();
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        record(`${theme} long action`, width, heroFaults(width, await measureHero(page), 'normal'));
      }

      // A 32px root text size (a browser default or text-only zoom) makes
      // the 22rem column minimum wider than a 640px hero. The copy must stay
      // inside the hero rather than be cut off by it.
      await page.setViewportSize({ width: 640, height: 900 });
      const largeText = await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
      const metrics = await measureHero(page);
      // Words break and the page header may scroll at this size; this case
      // checks only that the hero keeps its copy whole and off the picture.
      const found = heroFaults(640, { ...metrics, brokenWords: [], scrollWidth: metrics.clientWidth }, 'normal');
      record(`${theme} 32px root text`, 640, found);
      await largeText.evaluate((element) => element.remove());
    }
  } finally {
    await actionRef.delete();
    if (savedTheme) await themeRef.set(savedTheme);
    else await themeRef.delete();
    if (savedImage) await imageRef.set(savedImage);
    else await imageRef.delete();
  }

  await testInfo.attach('hero-geometry-edge-cases.json', {
    body: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    contentType: 'application/json',
  });
  expect(faults, `${faults.length} hero geometry faults`).toEqual([]);
});
