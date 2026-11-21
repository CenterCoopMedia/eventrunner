/* global document, getComputedStyle, innerWidth, devicePixelRatio, visualViewport, screen, navigator */
import { chromium, expect, test as base } from '@playwright/test';
import { REFLOW_PROFILES, setReflowProfile } from './reflow.mjs';

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
      const record = async (name, checkSetting, minimumTarget) => {
        await test.step(name, async () => {
          try {
            await checkSetting();
            const viewport = await readViewport(page);
            const text = await measureText(sample);
            await info.attach(`${name} measurements`, {
              body: JSON.stringify({
                browser, baseline, viewport, text, control: await measureText(control),
                renderedLineHeightChanged: text.lineHeight !== baseline.text.lineHeight,
              }, null, 2),
              contentType: 'application/json',
            });
            await check({ compact: viewport.innerWidth <= 639, minimumTarget });
          } catch (error) {
            await info.attach(`${name} screenshot`, { body: await page.screenshot(), contentType: 'image/png' });
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
        await record('Chromium Android OS text scale 200%', async () => {
          await cdp.send('Emulation.setEmulatedOSTextScale', { scale: 2 });
          expect(await readViewport(page)).toEqual({
            screenWidth: baseline.screenWidth, innerWidth: baseline.innerWidth,
            devicePixelRatio: baseline.devicePixelRatio, visualScale: baseline.visualScale,
          });
        }, 44);
      } else {
        await record('WebKit iPhone default text', async () => {}, 44);
        await record('WebKit iPhone 200% CSS text adjustment', async () => {
          await page.addStyleTag({ content: 'html { -webkit-text-size-adjust: 200% !important; }' });
          await expect(page.locator('html')).toHaveCSS('-webkit-text-size-adjust', '200%');
        }, 44);
      }
    });
  },
});
