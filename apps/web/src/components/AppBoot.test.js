import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.html'), 'utf8');

function mountBoot() {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const boot = parsed.getElementById('app-boot');
  const status = boot.querySelector('[role="status"]');
  document.body.append(boot);
  new Function(boot.querySelector('script').textContent)();
  return { boot, status };
}

beforeEach(() => vi.useFakeTimers({
  toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'],
}));

afterEach(async () => {
  document.getElementById('app-boot')?.remove();
  await Promise.resolve();
  delete window.__eventHeldUpBoot;
  vi.useRealTimers();
});

describe('the static boot fallback', () => {
  it('registers one empty region, then writes only one line at each deadline', () => {
    const { boot, status } = mountBoot();
    const mutations = new MutationObserver(() => {});
    mutations.observe(status, { childList: true });
    const copy = boot.querySelector('p');
    const reload = boot.querySelector('button');
    expect(boot.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toBeEmptyDOMElement();
    expect(copy).toHaveAttribute('aria-hidden', 'true');
    vi.advanceTimersByTime(999);
    expect(copy).toBeEmptyDOMElement();
    expect(mutations.takeRecords()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(copy.textContent).toBe('Opening this site…');
    expect(reload.hidden).toBe(true);
    vi.advanceTimersByTime(50);
    expect(status.textContent).toBe('Opening this site…');
    expect(mutations.takeRecords()).toHaveLength(1);
    vi.advanceTimersByTime(8_949);
    expect(mutations.takeRecords()).toHaveLength(0);
    expect(reload.hidden).toBe(true);

    vi.advanceTimersByTime(1);
    const late = 'This site is taking longer than usual to open. You can keep waiting or reload this page.';
    expect(copy.textContent).toBe(late);
    expect(reload.hidden).toBe(false);
    vi.advanceTimersByTime(50);
    expect(status.textContent).toBe(late);
    expect(mutations.takeRecords()).toHaveLength(1);
    expect(boot.querySelector('[role="status"]')).toBe(status);
    mutations.disconnect();
  });

  it('cancels both boot announcements when the app replaces the shell at 300 ms', async () => {
    const { boot, status } = mountBoot();
    vi.advanceTimersByTime(300);
    boot.remove();
    await Promise.resolve();
    vi.advanceTimersByTime(10_000);
    expect(status).toBeEmptyDOMElement();
    expect(window.__eventHeldUpBoot).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
