/* global getComputedStyle, NodeFilter */
import { expect } from '@playwright/test';

export const REFLOW_PROFILES = [
  { name: '320 CSS px', width: 320 },
  { name: '720 CSS px (half-width proxy)', width: 720 },
  { name: '720 CSS px with a 32px root (synthetic text enlargement)', width: 720, rootSize: 32 },
];

export async function setReflowProfile(page, { width, rootSize }) {
  await page.setViewportSize({ width, height: 800 });
  const html = page.locator('html');
  await html.evaluate((element, size) => {
    if (size) element.style.setProperty('font-size', `${size}px`, 'important');
    else element.style.removeProperty('font-size');
  }, rootSize);
  if (rootSize) await expect(html).toHaveCSS('font-size', `${rootSize}px`);
}

export async function expectPageFits(page) {
  await expect.poll(() => page.locator('html').evaluate((html) =>
    Math.max(html.scrollWidth, html.ownerDocument.body.scrollWidth) - html.clientWidth,
  ), { message: 'the document fits the viewport horizontally' }).toBeLessThanOrEqual(1);
}

// Measure rendered text against clipping ancestors, including fixed-size
// controls whose scrollWidth can stay hidden from the document.
export async function expectTextFits(locator) {
  await expect(locator).toBeVisible();
  const clipped = await locator.evaluate(async (element) => {
    const doc = element.ownerDocument;
    await doc.fonts.ready;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    const clips = (overflow) => overflow === 'hidden' || overflow === 'clip';
    const problems = [];
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.data.trim() || text.parentElement.closest('[aria-hidden="true"], .sr-only, .visually-hidden')) continue;
      range.selectNodeContents(text);
      for (const line of range.getClientRects()) {
        if (line.width === 0) continue;
        for (let ancestor = text.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          const bounds = ancestor.getBoundingClientRect();
          const left = bounds.left + ancestor.clientLeft;
          const top = bounds.top + ancestor.clientTop;
          if ((clips(style.overflowX) && (line.left < left - 1 || line.right > left + ancestor.clientWidth + 1))
            || (clips(style.overflowY) && (line.top < top - 1 || line.bottom > top + ancestor.clientHeight + 1))) {
            problems.push({ text: text.data.trim(), clippedBy: ancestor.tagName, className: ancestor.className });
            break;
          }
        }
      }
    }
    return problems;
  });
  expect(clipped, `rendered text stays visible in ${locator}`).toEqual([]);
}

export async function expectControlFits(control, target = 44) {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  const { x, width, height } = await control.boundingBox();
  const viewport = await control.page().locator('html').evaluate((html) => html.clientWidth);
  expect(x, String(control)).toBeGreaterThanOrEqual(-1);
  expect(x + width, String(control)).toBeLessThanOrEqual(viewport + 1);
  expect(width, String(control)).toBeGreaterThanOrEqual(target);
  expect(height, String(control)).toBeGreaterThanOrEqual(target);
  if (await control.isEnabled()) await control.click({ trial: true });
}
