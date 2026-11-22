import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isCanonicalPagePath } from 'shared/routing';
import { criticalFontTags } from './criticalFonts.js';

const PUBLIC_MODULES = new Set([
  'Schedule.jsx', 'MySchedule.jsx', 'SessionDetail.jsx', 'Speakers.jsx', 'SpeakerDetail.jsx',
  'Sponsors.jsx', 'SponsorDetail.jsx', 'Updates.jsx', 'UpdateDetail.jsx', 'ContentPage.jsx',
  'PublicLanguageRuntime.jsx', 'LanguageChoice.jsx', 'FooterPageLinks.jsx', 'TimelineDetails.jsx',
  'LatestUpdatesBlock.jsx', 'MapBlock.jsx', 'QuoteBlock.jsx', 'FaqItemBlock.jsx', 'LinkGroupBlock.jsx',
  'SponsorPackageBlock.jsx', 'GalleryBlock.jsx', 'TimelineBlock.jsx', 'CaptionedImageFigure.jsx',
  'SavedPublicNotice.jsx', 'busyControlFigures.js', 'leaflet-src.js',
]);

const NETWORK_ONLY = /^\/(?:admin|ticket|tickets|profile|speaker|attendees|schedule\/(?:mine|user)|pitch|registration|signin|unsubscribe|dashboard|low-bandwidth|specimen)(?:\/|$)/;

export function offlineBundle({ root, generatedDir, project }) {
  const require = createRequire(path.join(root, 'vite.config.js'));
  let base;
  return {
    name: 'offline-public-inputs',
    apply: 'build',
    configResolved(config) { base = config.base; },
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        if (!project || !bundle['index.html']) return;
        const { readGeneratedSnapshot } = require('../../scripts/write-site-files.cjs');
        const { collectPublicRoutes } = require('../../scripts/lib/site-manifest.cjs');
        const snapshot = await readGeneratedSnapshot({ generatedDir });
        const routes = snapshot.comingSoon ? [] : collectPublicRoutes(snapshot)
          .map((route) => route.path)
          .filter((route) => isCanonicalPagePath(route) && !NETWORK_ONLY.test(route));
        const files = new Set(['app-shell.html', 'branding/favicon.svg', 'manifest.webmanifest']);
        const addChunk = (file) => {
          if (files.has(file)) return;
          const chunk = bundle[file];
          if (chunk?.type !== 'chunk') this.error(`Missing public offline chunk ${file}`);
          files.add(file);
          for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(css);
          for (const dependency of chunk.imports) addChunk(dependency);
        };
        for (const asset of Object.values(bundle)) {
          // Rolldown can place a named route inside a manual group without a
          // facade. Check the actual module graph as well as facade IDs.
          if (asset.type === 'chunk' && (asset.isEntry || [asset.facadeModuleId, ...asset.moduleIds]
            .some((id) => id && PUBLIC_MODULES.has(path.basename(id))))) addChunk(asset.fileName);
          if (asset.type === 'asset' && /^assets\/leaflet-[\w-]+\.css$/.test(asset.fileName)) files.add(asset.fileName);
        }
        // Vite's HTML names the eagerly extracted CSS and critical font faces.
        const html = String(bundle['index.html'].source);
        for (const [, url] of html.matchAll(/href="([^"]+\.css)"/g)) {
          if (url.startsWith(base)) files.add(url.slice(base.length));
        }
        const css = readFileSync(path.join(generatedDir, 'theme.css'), 'utf8');
        for (const tag of criticalFontTags(css)) files.add(tag.attrs.href.slice(1));
        this.emitFile({
          type: 'asset',
          fileName: '.vite/offline-public.json',
          source: JSON.stringify({ project, base, routes: [...new Set(routes)].sort(),
            generatedAt: snapshot.snapshotGeneratedAt, files: [...files].sort() }),
        });
      },
    },
  };
}
