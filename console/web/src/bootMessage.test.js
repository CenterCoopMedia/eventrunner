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
  const script = doc.head.querySelector('script:not([src])');
  document.body.innerHTML = '';
  document.body.append(document.importNode(doc.getElementById('root'), true));
  // Inserted scripts do not run; run the head script once, as the parser would.
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

  it('changes nothing once the app has replaced it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    mountBoot();
    document.getElementById('root').replaceChildren(Object.assign(document.createElement('h1'), { textContent: 'Your organizations' }));
    vi.advanceTimersByTime(10000);
    expect(document.getElementById('root').textContent).toBe('Your organizations');
  });

  it('runs in the head, ahead of any stylesheet, so a slow stylesheet cannot hold it', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const script = doc.head.querySelector('script:not([src])');
    expect(script).not.toBeNull();
    expect(doc.querySelector('link[rel="stylesheet"]')).toBeNull();
    expect(doc.body.querySelector('script:not([src])')).toBeNull();
  });
});
