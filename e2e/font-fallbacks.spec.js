import { test, expect } from '@playwright/test';

const cases = [
  { path: '/', summary: 'Explore the sessions and people behind' },
  { path: '/contact', summary: 'Learn about the organization' },
];

test.use({ reducedMotion: 'reduce' });

test('adjusted local fallbacks reduce the width change when a body font arrives', async ({ page }) => {
  await page.goto('/');
  const samples = await page.locator('main').evaluate(async (main) => {
    const doc = main.ownerDocument;
    const specimen = doc.createElement('span');
    specimen.style.cssText = 'position:absolute;white-space:nowrap;visibility:hidden';
    specimen.textContent = 'Encuentra una sesión sobre periodismo y comunidad.';
    main.append(specimen);
    try {
      const measure = async (family, required = true) => {
        specimen.style.font = `400 32px ${family}`;
        const loaded = await doc.fonts.load(specimen.style.font, specimen.textContent);
        if (required && loaded.length === 0) throw new Error(`Font face missing: ${family}`);
        return specimen.getBoundingClientRect().width;
      };
      const metrics = [];
      for (const [family, fallback, original] of [
        ['Merriweather', 'merriweather fallback', 'Liberation Serif'],
        ['Public Sans', 'public-sans fallback', 'Liberation Sans'],
        ['Libre Caslon Text', 'caslon-text fallback', 'Liberation Serif'],
      ]) {
        metrics.push({
          family,
          web: await measure(`"${family}"`),
          adjusted: await measure(`"${fallback}"`),
          original: await measure(`"${original}"`, false),
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

for (const width of [320, 1280]) {
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
