import { describe, expect, it } from 'vitest';
import { injectSnapshotHtml } from '../snapshotHtml.js';

function documentFor(route, { search = '', width = 390, paints = [], visibility = 'visible', paintSupported = true } = {}) {
  const html = injectSnapshotHtml('<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="modulepreload" href="/assets/shared.js" crossorigin></head><body><div id="root">Opening</div><script type="module" src="/assets/index-test.js" crossorigin></script></body></html>', {
    routes: ['/', '/schedule', '/speakers'].flatMap((path) => ['compact', 'standard', 'wide'].map((viewport) => ({
      route: path,
      viewport,
      html: `<main data-layout="${viewport}"><h1>${path}</h1><p>Cost: $$ and $&amp;</p><img class="event-hero__art" src="/demo/hero.jpg" srcSet="/demo/small.webp 640w, /demo/hero.jpg 1200w" sizes="100vw"></main>`,
    }))),
    attributes: { 'data-theme': 'newsroom', 'data-motif-set': 'press' },
    display: { style: 'newsroom', mode: 'light' },
  });
  const document = new DOMParser().parseFromString(html, 'text/html');
  Object.defineProperty(document, 'visibilityState', { value: visibility, writable: true });
  const location = { hash: `#${route}`, search };
  const view = {
    matchMedia: (query) => ({ matches: query.includes('max-width') ? width <= 639 : width >= 1024 }),
    PerformanceObserver: paintSupported ? class {
      static supportedEntryTypes = ['paint'];
      constructor(callback) { this.callback = callback; }
      observe(options) {
        expect(options).toEqual({ type: 'paint', buffered: true });
        paints.push((name) => this.callback({ getEntries: () => [{ name }] }));
      }
      disconnect() {}
    } : undefined,
  };
  for (const script of document.querySelectorAll('script')) {
    new Function('document', 'location', 'window', script.textContent)(document, location, view);
  }
  return document;
}

describe('parser snapshot selection', () => {
  it('preserves base-relative responsive image candidates in the head hint', () => {
    const document = documentFor('/schedule');
    const hint = document.head.querySelector('link[as="image"]');
    expect(hint.getAttribute('href')).toBe('/demo/hero.jpg');
    expect(hint.getAttribute('imagesrcset')).toBe('/demo/small.webp 640w, /demo/hero.jpg 1200w');
    expect(hint.getAttribute('imagesizes')).toBe('100vw');
    expect(hint.getAttribute('fetchpriority')).toBe('high');
    expect(document.querySelector('#root main h1').textContent).toBe('/schedule');
    expect(document.querySelector('#root').dataset.snapshotRoute).toBe('/schedule');
    expect(document.documentElement.dataset.theme).toBe('newsroom');
    expect(document.querySelector('#root p').textContent).toBe('Cost: $$ and $&');
    const script = document.head.querySelector('script');
    const stylesheet = document.head.querySelector('link[rel="stylesheet"]');
    expect(script.compareDocumentPosition(stylesheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the requested public route without installing another route or an account page', () => {
    expect(documentFor('/speakers').querySelector('#root h1').textContent).toBe('/speakers');
    for (const route of ['/signin', '/profile', '/schedule?q=local']) {
      const document = documentFor(route);
      expect(document.querySelector('#root').textContent).toBe('Opening');
      expect(document.querySelector('script[src]').getAttribute('src')).toBe('/assets/index-test.js');
      expect(document.head.querySelector('link[href="/assets/index-test.js"]').getAttribute('rel')).toBe('modulepreload');
    }
    expect(documentFor('/speakers', { search: '?style=zine' }).querySelector('#root').textContent).toBe('Opening');
    expect(documentFor('/speakers', { search: '?style=newsroom&mode=light' }).querySelector('#root h1').textContent).toBe('/speakers');
    for (const route of ['/speakers', '/signin', '/profile']) {
      expect(documentFor(route).head.querySelector('link[as="image"]')).toBeNull();
    }
    expect(documentFor('/', { search: '?style=zine' }).head.querySelector('link[as="image"]')).toBeNull();
  });

  it('selects the actual viewport layout before any entry module runs', () => {
    for (const [width, layout] of [[390, 'compact'], [800, 'standard'], [1440, 'wide']]) {
      const paints = [];
      const document = documentFor('/schedule', { width, paints });
      expect(document.querySelector('#root main').dataset.layout).toBe(layout);
      expect(document.querySelector('#root').dataset.snapshotViewport).toBe(layout);
      expect(document.querySelector('script[src]')).toBeNull();
      expect(document.querySelector('link[rel="modulepreload"]')).toBeNull();
      paints[0]('first-paint');
      expect(document.querySelector('script[src]')).toBeNull();
      paints.shift()('first-contentful-paint');
      expect(document.querySelector('script[src]').getAttribute('src')).toBe('/assets/index-test.js');
      expect(document.querySelector('script[src]').hasAttribute('crossorigin')).toBe(true);
      expect(document.querySelector('link[rel="modulepreload"]').getAttribute('href')).toBe('/assets/shared.js');
    }
    expect(documentFor('/', { visibility: 'hidden' }).querySelector('script[src]')).not.toBeNull();
    expect(documentFor('/', { paintSupported: false }).querySelector('script[src]')).not.toBeNull();
    const paints = [];
    const document = documentFor('/', { paints });
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.querySelectorAll('script[src]')).toHaveLength(1);
    paints.shift()('first-contentful-paint');
    expect(document.querySelectorAll('script[src]')).toHaveLength(1);
  });
});
