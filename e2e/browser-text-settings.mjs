/* global document, getComputedStyle, innerWidth, devicePixelRatio, visualViewport, screen */
import { chromium, expect, test as base } from '@playwright/test';
import { REFLOW_PROFILES, setReflowProfile, setRootTextSize } from './reflow.mjs';

export const settingsTag = { tag: '@browser-text-settings' };

const readViewport = (page) => page.evaluate(() => ({
  screenWidth: screen.width,
  innerWidth,
  devicePixelRatio,
  visualScale: visualViewport.scale,
}));

async function measureText(locator) {
  return locator.evaluate(async (element) => {
    await document.fonts.ready;
    const range = document.createRange();
    range.selectNodeContents(element);
    const { width, height } = element.getBoundingClientRect();
    return { font: getComputedStyle(element).fontSize, lineHeight: range.getClientRects()[0]?.height, width, height };
  });
}

async function setChromeZoom(settings, factor) {
  const zoom = settings.locator('select#zoomLevel');
  await zoom.selectOption(String(factor));
  await expect(zoom).toHaveValue(String(factor));
}

// Chromium exposes the OS scale on desktop for documents that opt in. Use
// a separate document so reading it does not change the route's rendering.
const readOsTextScale = (page) => page.evaluate(async () => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position: fixed; width: 1px; height: 1px; border: 0; visibility: hidden';
  frame.srcdoc = '<meta name="text-scale" content="scale"><span style="font-size:calc(16px * env(preferred-text-scale, 0))">Scale</span>';
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  document.body.append(frame);
  try {
    await loaded;
    const sample = frame.contentDocument.querySelector('span');
    return Number.parseFloat(frame.contentWindow.getComputedStyle(sample).fontSize) / 16;
  } finally {
    frame.remove();
  }
});

export const test = base.extend({
  textSettings: [null, { option: true }],

  context: async ({ context, textSettings, baseURL, locale }, use) => {
    if (textSettings !== 'chrome-zoom') {
      await use(context);
      return;
    }
    // A fresh profile lets Chrome change its real default Page zoom in Settings.
    // Keep the native window size and let zoom change the CSS viewport.
    const desktop = await chromium.launchPersistentContext('', {
      channel: 'chrome',
      chromiumSandbox: true,
      baseURL,
      locale,
      hasTouch: false,
      reducedMotion: 'reduce',
      viewport: null,
      args: ['--screen-info={1440x900}', '--window-size=1440,900'],
    });
    try {
      await use(desktop);
    } finally {
      await desktop.close();
    }
  },

  checkReflow: async ({ page, textSettings }, use, info) => {
    await use(async (sample, check, control = sample) => {
      if (!textSettings) {
        for (const profile of REFLOW_PROFILES) {
          await test.step(profile.name, async () => {
            await setReflowProfile(page, profile);
            await check({ compact: profile.width <= 639, minimumTarget: 44 });
          });
        }
        return;
      }

      const browser = page.context().browser()?.version() ?? await page.evaluate(() => navigator.userAgent);
      const baseline = { ...await readViewport(page), text: await measureText(sample), control: await measureText(control) };
      const record = async (name, checkSetting, minimumTarget, requireLargerText = false) => {
        await test.step(name, async () => {
          try {
            await checkSetting();
            const viewport = await readViewport(page);
            const text = await measureText(sample);
            const dimensions = await measureText(control);
            await info.attach(`${name} measurements`, {
              body: JSON.stringify({
                browser, baseline, viewport, text, control: dimensions,
                renderedLineHeightChanged: text.lineHeight !== baseline.text.lineHeight,
              }, null, 2),
              contentType: 'application/json',
            });
            if (requireLargerText) {
              // A responsive heading can be limited by the available width.
              // Verify a rendered text range grows in the sample or its control.
              const largerText = text.lineHeight > baseline.text.lineHeight
                || dimensions.lineHeight > baseline.control.lineHeight;
              expect(largerText, 'the larger text profile enlarges the sample text or control label').toBe(true);
            }
            await check({ compact: viewport.innerWidth <= 639, minimumTarget });
          } catch (error) {
            await info.attach(`${name} screenshot`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
            const overflow = await page.evaluate(() => {
              const width = document.documentElement.clientWidth;
              return Array.from(document.querySelectorAll('main *')).flatMap((element) => {
                const bounds = element.getBoundingClientRect();
                return bounds.right > width + 1
                  ? [{ tag: element.tagName, class: element.getAttribute('class'), right: bounds.right }]
                  : [];
              }).slice(0, 12);
            });
            if (overflow.length) await info.attach('Elements beyond the viewport', {
              body: JSON.stringify(overflow, null, 2), contentType: 'application/json',
            });
            throw error;
          }
        });
      };

      if (textSettings === 'chrome-zoom') {
        expect(baseline.screenWidth).toBe(1440);
        expect(baseline.innerWidth).toBe(1440);
        const settings = await page.context().newPage();
        try {
          await settings.goto('chrome://settings/appearance');
          await expect(settings.locator('select#zoomLevel')).toHaveValue('1');
          for (const factor of [2, 4]) {
            await record(`Chrome page zoom ${factor * 100}%`, async () => {
              await setChromeZoom(settings, factor);
              await page.bringToFront();
              await expect.poll(() => readViewport(page)).toMatchObject({
                screenWidth: baseline.screenWidth,
                innerWidth: baseline.innerWidth / factor,
                devicePixelRatio: baseline.devicePixelRatio * factor,
                visualScale: baseline.visualScale,
              });
            }, 24);
          }
        } finally {
          await settings.close();
        }
      } else if (textSettings === 'android-text') {
        const cdp = await page.context().newCDPSession(page);
        expect(await readOsTextScale(page)).toBe(1);
        await record('Chromium Android OS text scale 200%', async () => {
          await cdp.send('Emulation.setEmulatedOSTextScale', { scale: 2 });
          expect(await readOsTextScale(page)).toBe(2);
          expect(await readViewport(page)).toEqual({
            screenWidth: baseline.screenWidth, innerWidth: baseline.innerWidth,
            devicePixelRatio: baseline.devicePixelRatio, visualScale: baseline.visualScale,
          });
        }, 44);
      } else {
        await record('WebKit iPhone default text', async () => {}, 44);
        const rootSize = await page.locator('html').evaluate((html) => Number.parseFloat(getComputedStyle(html).fontSize));
        await record('WebKit iPhone 200% root text stress', () => setRootTextSize(page, rootSize * 2), 44, true);
      }
    });
  },
});
