import { test, expect } from '@playwright/test';

const cases = [
  { path: '/', summary: 'Explore the sessions and people behind' },
  { path: '/contact', summary: 'Learn about the organization' },
];

test.use({ reducedMotion: 'reduce' });

test('adjusted local fallbacks reduce the width change when regular and bold fonts arrive', async ({ page }) => {
  await page.goto('/');
  const samples = await page.locator('main').evaluate(async (main) => {
    const doc = main.ownerDocument;
    const specimen = doc.createElement('span');
    specimen.style.cssText = 'position:absolute;white-space:nowrap;visibility:hidden';
    specimen.textContent = 'Encuentra una sesión sobre periodismo y comunidad.';
    main.append(specimen);
    try {
      const measure = async (family, weight, required = true) => {
        specimen.style.font = `${weight} 32px ${family}`;
        const loaded = await doc.fonts.load(specimen.style.font, specimen.textContent);
        if (required && loaded.length === 0) throw new Error(`Font face missing: ${family}`);
        return specimen.getBoundingClientRect().width;
      };
      const metrics = [];
      for (const [family, fallback, original, weight] of [
        ['Merriweather', 'merriweather fallback', 'Liberation Serif', 400],
        ['Public Sans', 'public-sans fallback', 'Liberation Sans', 400],
        ['Libre Caslon Text', 'caslon-text fallback', 'Liberation Serif', 400],
        ['Merriweather', 'merriweather fallback', 'Liberation Serif', 700],
      ]) {
        metrics.push({
          family,
          weight,
          web: await measure(`"${family}"`, weight),
          adjusted: await measure(`"${fallback}"`, weight),
          original: await measure(`"${original}"`, weight, false),
        });
      }
      return metrics;
    } finally {
      specimen.remove();
    }
  });
  for (const { web, adjusted, original } of samples) {
    expect(Math.abs(adjusted - web)).toBeLessThan(Math.abs(original - web));
  }
  console.log(`Font fallback widths: ${JSON.stringify(samples)}`);
});

test('the Home heading uses the measured bold fallback during a delayed font request', async ({ page }, testInfo) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/merriweather-700-latin.woff2', async (route) => {
    await held;
    await route.continue();
  });

  try {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const heading = page.locator('main').getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    const faces = await heading.evaluate(async (element) => {
      // Keep this case on the same face even if the live fixture's preset changes.
      element.style.fontFamily = '"Merriweather", "merriweather fallback", serif';
      element.style.fontWeight = '700';
      const doc = element.ownerDocument;
      const fontSize = doc.defaultView.getComputedStyle(element).fontSize;
      const local = await doc.fonts.load(`700 ${fontSize} "merriweather fallback"`, element.textContent);
      return local.map((face) => ({ weight: face.weight, status: face.status }));
    });
    expect(faces).toEqual([{ weight: '700', status: 'loaded' }]);

    const measure = () => heading.evaluate((element) => {
      const doc = element.ownerDocument;
      const range = doc.createRange();
      range.selectNodeContents(element);
      const webFace = [...doc.fonts].find((face) => (
        face.family.replace(/^['"]|['"]$/g, '') === 'Merriweather' && face.weight === '700'
      ));
      const box = ({ x, y, width, height }) => [x, y, width, height];
      return {
        webStatus: webFace?.status,
        heading: box(element.getBoundingClientRect()),
        text: [...range.getClientRects()].map(box),
      };
    });
    await expect.poll(async () => (await measure()).webStatus).toBe('loading');
    const before = await measure();
    expect(before.text.length).toBeGreaterThan(0);
    release();
    await expect.poll(async () => (await measure()).webStatus).toBe('loaded');
    const after = await measure();
    console.log(`Home heading font geometry: ${JSON.stringify({ before, after })}`);
    await testInfo.attach('Home heading font geometry', {
      body: JSON.stringify({ before, after }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    release();
  }
});

for (const width of [320, 768, 1280]) {
  for (const { path, summary } of cases) {
    test(`${path} loaded heading and body boxes match the original stacks at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('main').getByText(summary, { exact: false })).toBeVisible();

      const result = await page.locator('main').evaluate(async (main, excerpt) => {
        const doc = main.ownerDocument;
        const view = doc.defaultView;
        const root = doc.documentElement;
        const elements = [
          main.querySelector('h1'),
          [...main.querySelectorAll('p')].find((paragraph) => paragraph.textContent.startsWith(excerpt)),
        ];
        const measure = () => elements.map((element) => {
          const range = doc.createRange();
          range.selectNodeContents(element);
          const box = ({ x, y, width, height }) => [x, y, width, height];
          return { element: box(element.getBoundingClientRect()), text: [...range.getClientRects()].map(box) };
        });

        const fonts = await Promise.all(elements.map(async (element) => {
          const style = view.getComputedStyle(element);
          const family = style.fontFamily.split(',')[0];
          const faces = await doc.fonts.load(`${style.fontWeight} ${style.fontSize} ${family}`, element.textContent);
          return { family, fetched: faces.length > 0 && faces.every((face) => face.status === 'loaded') };
        }));
        await doc.fonts.ready;
        const adjusted = measure();

        const adjustedRoles = [];
        for (const role of ['heading', 'body', 'data', 'mono']) {
          const property = `--font-${role}`;
          const stack = view.getComputedStyle(root).getPropertyValue(property);
          const original = stack.split(',').filter((entry) => !/ fallback['"]?$/.test(entry.trim())).join(',');
          if (original === stack) continue;
          adjustedRoles.push(role);
          root.style.setProperty(property, original);
        }
        await doc.fonts.ready;
        return { fonts, adjustedRoles, adjusted, original: measure() };
      }, summary);

      expect(result.fonts.every((font) => font.fetched)).toBe(true);
      expect(result.adjustedRoles).toEqual(expect.arrayContaining(['heading', 'body']));
      expect(result.adjusted).toEqual(result.original);
      console.log(`Font geometry ${path} ${width}px: ${JSON.stringify(result.adjusted)}`);
      await testInfo.attach('Loaded font geometry', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
      });
    });
  }
}
