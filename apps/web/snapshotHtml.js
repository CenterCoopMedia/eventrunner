import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { isDemoModeFlag } from './src/lib/demoModeFlag.js';
import { snapshotViewport } from './src/lib/snapshotViewport.js';

function matchesDisplay(search, display) {
  const params = new URLSearchParams(search);
  return (!params.has('style') || params.get('style') === display.style)
    && (!params.has('mode') || params.get('mode') === display.mode);
}

/** Static, read-only demos can ship the same public React tree as HTML. */
export function snapshotHtml() {
  let config;
  return {
    name: 'snapshot-html',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
    async closeBundle() {
      if (config.build.ssr || !isDemoModeFlag(process.env.VITE_DEMO_MODE)) return;
      const { default: sharp } = await import('sharp');
      const hero = await sharp(path.join(config.root, 'public/hero/nclocal-summit.jpg'))
        .rotate()
        .webp({ quality: 80 })
        .toFile(path.resolve(config.root, config.build.outDir, 'hero/nclocal-summit.webp'));
      console.log(`Demo hero WebP: ${hero.size} bytes (${hero.width} x ${hero.height}).`);
      const temporary = await mkdtemp(path.join(config.root, '.snapshot-'));
      try {
        const { build } = await import('vite');
        await build({
          configFile: config.configFile,
          root: config.root,
          base: config.base,
          logLevel: 'warn',
          build: {
            ssr: path.join(config.root, 'src/snapshot.jsx'),
            outDir: temporary,
            emptyOutDir: true,
            copyPublicDir: false,
            rolldownOptions: { output: { entryFileNames: 'render.mjs' } },
          },
        });
        const { renderSnapshots } = await import(pathToFileURL(path.join(temporary, 'render.mjs')).href);
        const snapshots = await renderSnapshots();
        const index = path.resolve(config.root, config.build.outDir, 'index.html');
        const html = injectSnapshotHtml(await readFile(index, 'utf8'), snapshots);
        await writeFile(index, html);
        console.log(`Static snapshot HTML: ${Buffer.byteLength(html)} raw / ${gzipSync(html).length} gzip bytes (${snapshots.routes.length} layouts).`);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  };
}

export function injectSnapshotHtml(html, { routes, attributes, display }) {
  const dom = new JSDOM(html);
  const modules = [...dom.window.document.querySelectorAll('script[type="module"], link[rel="modulepreload"]')].map((tag) => {
    const markup = tag.outerHTML;
    tag.remove();
    return markup;
  });
  const page = dom.serialize();
  dom.window.close();
  // Keep Vite's exact resource tags in the document (and bundle budget),
  // but let the static content paint before starting their requests.
  const entry = `<template id="app-modules">${modules.join('\n')}</template>`;
  const templates = routes.map(({ route, viewport, html: markup }) =>
    `<template data-snapshot-route="${route}" data-snapshot-viewport="${viewport}">${markup}</template>`).join('\n');
  const snapshotRoutes = JSON.stringify([...new Set(routes.map(({ route }) => route))]);
  // Home and Program use the same source and responsive candidates. Start
  // their request while parsing the head, before stylesheets or app modules.
  const hero = /<img\b[^>]*class="event-hero__art"[^>]*>/.exec(routes[0].html)?.[0];
  const attribute = (name) => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(hero ?? '')?.[1];
  const src = attribute('src');
  const srcset = attribute('srcSet');
  const sizes = attribute('sizes');
  const preload = src ? `<link rel="preload" as="image" fetchpriority="high" href="${src}"${srcset ? ` imagesrcset="${srcset}" imagesizes="${sizes}"` : ''}>` : '';
  const displayMatches = `(${matchesDisplay.toString()})(location.search, ${JSON.stringify(display).replace(/</g, '\\u003c')})`;
  const headBootstrap = `<script>
    (() => {
      const matchesSnapshot = ${displayMatches} && ${snapshotRoutes}.includes(location.hash.slice(1) || '/');
      if (!matchesSnapshot) {
        const entry = document.getElementById('app-modules');
        for (const source of [...entry.content.children]) {
          if (source.localName === 'link') document.head.appendChild(source);
          else if (source.hasAttribute('src')) {
            const hint = document.createElement('link');
            hint.rel = 'modulepreload';
            for (const { name, value } of source.attributes) {
              if (name !== 'type') hint.setAttribute(name === 'src' ? 'href' : name, value);
            }
            document.head.appendChild(hint);
          }
        }
      }
      ${preload ? `if (${displayMatches} && ['/', '/schedule'].includes((location.hash.slice(1) || '/').split('?')[0])) {
        document.head.insertAdjacentHTML('beforeend', ${JSON.stringify(preload).replace(/</g, '\\u003c')});
      }` : ''}
    })();
  </script>`;
  const bootstrap = `<script>
    (() => {
      const entry = document.getElementById('app-modules');
      let paintObserver;
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') startEntry();
      };
      const startEntry = () => {
        if (!entry.isConnected) return;
        paintObserver?.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        for (const source of entry.content.children) {
          const tag = document.createElement(source.localName);
          for (const { name, value } of source.attributes) tag.setAttribute(name, value);
          tag.textContent = source.textContent;
          document.head.appendChild(tag);
        }
        entry.remove();
      };
      const route = location.hash.slice(1) || '/';
      const viewport = (${snapshotViewport.toString()})(window);
      // A filtered Program or a different preview style needs its own live
      // render. Never hydrate default content against a different URL state.
      const template = ${displayMatches} && ${snapshotRoutes}.includes(route)
        ? [...document.querySelectorAll('template[data-snapshot-route]')]
          .find((item) => item.dataset.snapshotRoute === route && item.dataset.snapshotViewport === viewport)
        : null;
      if (!template) { startEntry(); return; }
      const root = document.getElementById('root');
      const boot = document.getElementById('app-boot');
      if (boot) {
        boot.dataset.snapshot = 'true';
        root.after(boot);
      }
      root.replaceChildren(template.content.cloneNode(true));
      root.dataset.snapshotRoute = route;
      root.dataset.snapshotSearch = location.search;
      root.dataset.snapshotViewport = viewport;
      const attributes = ${JSON.stringify(attributes).replace(/</g, '\\u003c')};
      for (const [name, value] of Object.entries(attributes)) {
        if (value) document.documentElement.setAttribute(name, value);
      }
      if (document.visibilityState === 'hidden' || !window.PerformanceObserver?.supportedEntryTypes?.includes('paint')) startEntry();
      else {
        document.addEventListener('visibilitychange', onVisibility);
        paintObserver = new window.PerformanceObserver((list) => {
          if (list.getEntries().some(({ name }) => name === 'first-contentful-paint')) startEntry();
        });
        paintObserver.observe({ type: 'paint', buffered: true });
      }
    })();
  </script>`;
  return page.replace(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i, (meta) => `${meta}\n${entry}\n${headBootstrap}`)
    .replace('</body>', () => `${templates}\n${bootstrap}\n</body>`);
}
