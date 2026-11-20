// The first-load message in index.html, run as the browser runs it: an empty
// line before one second, the opening line at one second, the delay line
// and Reload at ten seconds, and nothing left once the app replaces it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(WEB, 'index.html'), 'utf8');

function mountBoot() {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.getElementById('root');
  const script = root.querySelector('script');
  document.body.innerHTML = '';
  document.body.append(document.importNode(root, true));
  // Inserted scripts do not run; run its text once, as the parser would.
  new Function(script.textContent)();
  return document.getElementById('console-boot');
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the first-load message', () => {
  it('paints nothing before one second, names the work at one second, and offers Reload at ten', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const boot = mountBoot();
    const status = boot.querySelector('[role="status"]');
    const reload = boot.querySelector('button');
    expect(status).toHaveAttribute('aria-live', 'polite');
    vi.advanceTimersByTime(999);
    expect(status.textContent).toBe('');
    expect(reload.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(status.textContent).toBe('Opening the console…');
    vi.advanceTimersByTime(8999);
    expect(reload.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(status.textContent).toBe('The console is taking longer than usual to open. You can keep waiting or reload this page.');
    expect(reload.hidden).toBe(false);
  });

  it('stops its clock when the app replaces it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const boot = mountBoot();
    expect(vi.getTimerCount()).toBe(2);
    document.getElementById('root').replaceChildren();
    await Promise.resolve();
    expect(boot.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
