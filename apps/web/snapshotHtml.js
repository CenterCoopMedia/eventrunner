import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
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
  const templates = routes.map(({ route, viewport, html: markup }) =>
    `<template data-snapshot-route="${route}" data-snapshot-viewport="${viewport}">${markup}</template>`).join('\n');
  // Home and Program use the same source and responsive candidates. Start
  // their request while parsing the head, before stylesheets or app modules.
  const hero = /<img\b[^>]*class="event-hero__art"[^>]*>/.exec(routes[0].html)?.[0];
  const attribute = (name) => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(hero ?? '')?.[1];
  const src = attribute('src');
  const srcset = attribute('srcSet');
  const sizes = attribute('sizes');
  const preload = src ? `<link rel="preload" as="image" fetchpriority="high" href="${src}"${srcset ? ` imagesrcset="${srcset}" imagesizes="${sizes}"` : ''}>` : '';
  const displayMatches = `(${matchesDisplay.toString()})(location.search, ${JSON.stringify(display).replace(/</g, '\\u003c')})`;
  const heroHint = preload ? `<script>
    if (${displayMatches} && ['/', '/schedule'].includes((location.hash.slice(1) || '/').split('?')[0])) {
      document.head.insertAdjacentHTML('beforeend', ${JSON.stringify(preload).replace(/</g, '\\u003c')});
    }
  </script>` : '';
  const bootstrap = `<script>
    (() => {
      const route = location.hash.slice(1) || '/';
      const viewport = (${snapshotViewport.toString()})(window);
      // A filtered Program or a different preview style needs its own live
      // render. Never hydrate default content against a different URL state.
      if (!${displayMatches} || !['/', '/schedule', '/speakers'].includes(route)) return;
      const template = [...document.querySelectorAll('template[data-snapshot-route]')]
        .find((item) => item.dataset.snapshotRoute === route && item.dataset.snapshotViewport === viewport);
      if (!template) return;
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
    })();
  </script>`;
  return html.replace(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i, (meta) => `${meta}\n${heroHint}`)
    .replace('</body>', () => `${templates}\n${bootstrap}\n</body>`);
}
