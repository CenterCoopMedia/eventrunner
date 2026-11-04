// The console's own favicon and sharing metadata (ADR 0007 §1). A shared
// console link must preview as the console, with its own image, and the
// tab must not look like a docs or an event site tab.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(WEB, 'index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');
const meta = (selector) => doc.head.querySelector(selector)?.getAttribute('content');

describe('index.html', () => {
  it('has a title, a description and the console favicon', () => {
    expect(doc.title).toBe('Event Runner console | Set up your event site');
    expect(meta('meta[name="description"]')).toMatch(/invite your team/);
    expect(doc.head.querySelector('link[rel="icon"]').getAttribute('href')).toBe('/favicon.svg');
    expect(doc.head.querySelector('link[rel="icon"]').getAttribute('type')).toBe('image/svg+xml');
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
  });

  it('has complete Open Graph and Twitter metadata with an absolute image', () => {
    for (const key of ['type', 'site_name', 'title', 'description', 'url', 'image', 'image:type', 'image:width', 'image:height', 'image:alt']) {
      expect(meta(`meta[property="og:${key}"]`), `og:${key}`).toBeTruthy();
    }
    for (const key of ['card', 'title', 'description', 'image', 'image:alt']) {
      expect(meta(`meta[name="twitter:${key}"]`), `twitter:${key}`).toBeTruthy();
    }
    expect(meta('meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(meta('meta[property="og:image"]')).toBe('https://console.eventrunner.org/og-console.png');
    expect(meta('meta[name="twitter:image"]')).toBe(meta('meta[property="og:image"]'));
  });

  it('never says Firebase, project or tenant in the metadata', () => {
    const words = [...doc.head.querySelectorAll('meta[content], title')]
      .map((node) => node.getAttribute('content') || node.textContent).join(' ');
    expect(words).not.toMatch(/firebase|project|tenant|environment|webhook/i);
  });
});

describe('brand files', () => {
  it('ships an SVG favicon with a dark-mode variant and an accessible name', () => {
    const svg = readFileSync(path.join(WEB, 'public', 'favicon.svg'), 'utf8');
    expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 24 24"/);
    expect(svg).toMatch(/aria-label="Event Runner console"/);
    expect(svg).toMatch(/prefers-color-scheme: dark/);
  });

  it('ships a 1200 by 630 PNG preview image', () => {
    const png = readFileSync(path.join(WEB, 'public', 'og-console.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});
