// Event hero geometry in every site style, mode and width (#345, #478).
//
// The hero sets its copy beside a photograph from 640px up. On phones,
// Home puts the photograph first; Schedule uses an image-only band.
// Two defects reached the public page because no check measured
// what a reader sees: the copy column ran onto the photograph (#345), and
// the copy started at the hero's coloured left edge with no inner inset
// (#478). This spec measures the rendered glyph boxes on Home and the
// Program page, not the CSS, so a later token change that moves the words
// onto the picture or against the edge fails here.
//
// It drives the real public Home page against the seeded emulators. The
// demo build is not used: its Newsroom style is the NC Local historical
// composition, and the shared Newsroom hero is the one #345 is about.
/* global document, Node, NodeFilter */
import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { adminDb } from './helpers.mjs';

const THEMES = ['civic', 'newsroom', 'broadsheet', 'atlas', 'field-guide', 'zine'];
const MODES = ['light', 'dark'];
const WIDTHS = [320, 360, 375, 640, 768, 1024, 1280, 1440, 1920];
// Below this width Home stacks artwork before its copy.
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
    const figure = hero.querySelector('.event-hero__figure');
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
    const figureRect = figure ? figure.getBoundingClientRect() : null;
    return {
      illustrated: hero.classList.contains('event-hero--illustrated'),
      artBeforeCopy: art ? Boolean(art.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
      hero: { left: heroRect.left, right: heroRect.right },
      copy: { right: copyRect.right, top: copyRect.top },
      art: artRect ? { left: artRect.left, top: artRect.top } : null,
      figure: figureRect ? { bottom: figureRect.bottom } : null,
      boxes,
      controls,
      brokenWords,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

test('published hero artwork skips the manifest and preserves the box and crop', async ({ page }) => {
  const original = 'cms-images/published-hero/hall.webp';
  const copy = 'cms-images/published-hero/_sizes/7/320.webp';
  const manifest = 'cms-images/published-hero/_sizes/manifest.json';
  const alt = 'A published photo of the venue';
  const block = { section: 'hero', field: 'image', blockType: 'image', url: original, alt, visible: true };
  const snapshot = { [original]: { width: 1280, sizes: [{ width: 320, path: copy }] } };
  const [originalImage, copyImage] = await Promise.all([1280, 320].map((width) => sharp({
    create: { width, height: width / 2, channels: 3, background: { r: 0, g: 0, b: 128 } },
  }).webp().toBuffer()));
  const requests = [];
  let published = false;
  let artworkBlock = block;
  // Both visits must measure the published content while live listeners are pending.
  await page.route('**/google.firestore.v1.Firestore/Listen/**', () => {});
  await page.route('**/src/generated/eventConfig.js*', async (route) => {
    const response = await route.fetch();
    const event = { name: 'Regional Organizers Summit', shortName: 'Regional Summit', tagline: '', historicalDemo: false };
    await route.fulfill({ response, body: `${await response.text()}\nObject.assign(eventConfig, ${JSON.stringify(event)});` });
  });
  await page.route('**/src/generated/siteContent.js*', async (route) => {
    const response = await route.fetch();
    const overrides = `
      siteContent.hero__image = ${JSON.stringify(artworkBlock)};
      siteContent.hero__title.value = 'Regional Organizers Summit';
      Object.assign(heroImageSizes, ${JSON.stringify(published ? snapshot : {})});
    `;
    await route.fulfill({ response, body: `${await response.text()}\n${overrides}` });
  });
  await page.route((url) => decodeURIComponent(url.pathname).includes('/o/cms-images/published-hero/'), async (route) => {
    const objectPath = decodeURIComponent(new URL(route.request().url()).pathname.split('/o/').at(-1));
    requests.push(objectPath);
    if (objectPath === manifest) {
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          status: 'ready', source: original, sourceGeneration: '7', width: 1280,
          sizes: [{ target: 320, width: 320, path: copy }],
        },
      });
    } else {
      await route.fulfill({
        contentType: 'image/webp',
        body: objectPath === copy ? copyImage : originalImage,
      });
    }
  });
  const artwork = page.getByRole('img', { name: alt });
  async function measureAtWidths(path, usePublishedSizes) {
    await page.goto('about:blank');
    published = usePublishedSizes;
    requests.length = 0;
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => artwork.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    if (artworkBlock.url === original) {
      // Routing disables caching, so a remounted figure can request the same URL again.
      expect([...new Set(requests)]).toEqual(published ? [copy] : [manifest, copy]);
    } else {
      expect(requests).toEqual([]);
      await expect(artwork).not.toHaveAttribute('srcset');
    }
    const boxes = [];
    for (const viewport of [320, 768, 1280]) {
      await page.setViewportSize({ width: viewport, height: 800 });
      let geometry;
      await expect.poll(async () => {
        geometry = await artwork.evaluate(async (image) => {
          // Flush the new viewport layout so fonts it needs are requested.
          image.getBoundingClientRect();
          await image.ownerDocument.fonts.ready;
          const { width, height } = image.getBoundingClientRect();
          const { objectFit, objectPosition } = globalThis.getComputedStyle(image);
          return image.complete && image.naturalWidth > 0 ? { width, height, objectFit, objectPosition } : null;
        });
        return geometry && geometry.width > 0 && geometry.height > 0;
      }, { message: `Rendered artwork on ${path} at ${viewport}px` }).toBe(true);
      boxes.push({ viewport, ...geometry });
    }
    if (usePublishedSizes) expect(requests).not.toContain(manifest);
    return boxes;
  }
  try {
    for (const [source, url] of [['library', original], ['site file', '/hero/civic.webp']]) {
      artworkBlock = { ...block, url, focalX: 20, focalY: 70 };
      for (const path of ['/', '/schedule']) {
        const before = await measureAtWidths(path, false);
        const after = await measureAtWidths(path, true);
        expect(after, `Geometry for ${source} artwork on ${path}`).toEqual(before);
        console.log(`Published hero geometry ${source} ${path} ${JSON.stringify(after)}`);
      }
    }
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

function round(value) {
  return Math.round(value * 10) / 10;
}

async function compactHeroFaults(page, illustrated) {
  const metrics = await page.evaluate(() => {
    const hero = document.querySelector('.event-hero');
    const art = hero?.querySelector('img');
    const box = art?.getBoundingClientRect();
    const frame = hero?.getBoundingClientRect();
    return {
      hero: Boolean(hero), copy: Boolean(hero?.querySelector('.event-hero__copy')),
      alt: art?.getAttribute('alt'), dateline: document.querySelector('.schedule-dateline')?.textContent,
      art: box ? { left: box.left, right: box.right, height: box.height } : null,
      frame: frame ? { left: frame.left, right: frame.right } : null,
      clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    };
  });
  const faults = [];
  if (metrics.copy) faults.push('compact artwork repeats event copy');
  if (!metrics.dateline) faults.push('Schedule is missing its event dateline');
  if (metrics.scrollWidth > metrics.clientWidth) faults.push('Schedule scrolls sideways');
  if (illustrated) {
    if (metrics.alt !== 'A wide photograph for the event hero.') faults.push('compact artwork loses its meaningful alt');
    if (!metrics.art || metrics.art.height <= 0) faults.push('compact artwork is not visible');
    else if (Math.abs(metrics.art.left - metrics.frame.left) > 1 || Math.abs(metrics.art.right - metrics.frame.right) > 1) faults.push('compact artwork does not fill its frame');
  } else if (metrics.hero) faults.push('Schedule draws an empty artwork band');
  return faults;
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
  } else if (metrics.illustrated) {
    if (!metrics.artBeforeCopy) {
      faults.push('the phone artwork reading order disagrees with the page treatment');
    }
    if (metrics.figure.bottom > metrics.copy.top + 0.5) {
      faults.push(`the phone artwork ends ${round(metrics.figure.bottom - metrics.copy.top)}px below the start of the copy`);
    }
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
          for (const route of copy === 'long' ? ['/'] : ['/', '/schedule']) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.goto(route);
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
            if (route === '/') {
              await expect(page.locator('.event-hero__title')).toBeVisible();
              await expect(page.locator('.event-hero--illustrated .event-hero__art')).toBeVisible();
              if (copy === 'long') await expect(page.locator('.event-hero__title')).toHaveText(LONG_TITLE);
            } else await expect(page.locator('.event-hero--compact .event-hero__art')).toBeVisible();
            await page.evaluate(() => document.fonts.ready);
            for (const width of WIDTHS) {
              await page.setViewportSize({ width, height: 900 });
              const found = route === '/' ? heroFaults(width, await measureHero(page), copy) : await compactHeroFaults(page, true);
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
          if (route === '/') await expect(page.locator('.event-hero:not(.event-hero--illustrated) .event-hero__title')).toBeVisible();
          else await expect(page.locator('main h1')).toBeVisible();
          for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: 900 });
            const found = route === '/' ? heroFaults(width, await measureHero(page), 'normal') : await compactHeroFaults(page, false);
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
