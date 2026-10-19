// Vite config for the attendee/admin frontend (spec §1.2).
//
// GENERATED_DIR: deploy-time generation (scripts/generate-content.cjs, §8.6)
// writes snapshot files to an out-of-tree directory instead of overwriting
// the committed synthetic demo copy. A real deploy passes that directory.
// Demo mode ignores it and uses the committed snapshot in src/generated,
// which keeps a specimen or demo build from embedding a client export (§8.1).
//
// Every source import of snapshot data goes through the `@generated` alias
// so the override applies to the whole app, theme.css included.
import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGeneratedDir } from './generatedDir.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = resolveGeneratedDir(process.env, path.resolve(here, 'src/generated'));
const entryModule = normalizePath(path.resolve(here, 'src/main.jsx'));

// Vite 8 bundles with Rolldown. Rollup put every module the entry imports
// statically into the entry chunk. Rolldown splits the same modules into one
// small common chunk per set of importers: about 40 files on first paint, and
// about 8 kB more gzip, because small files compress worse. This group puts
// the static import graph of src/main.jsx back into one chunk, so first paint
// loads the entry, the Rolldown runtime and this chunk. Lazy routes still
// split as before. CSS stays with Vite's CSS plugin.
const initialModules = new WeakMap();
function staticImportGraph(context) {
  if (initialModules.has(context)) return initialModules.get(context);
  const seen = new Set();
  const queue = [entryModule];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const info = context.getModuleInfo(id);
    if (info) queue.push(...info.importedIds);
  }
  initialModules.set(context, seen);
  return seen;
}

export default defineConfig({
  plugins: [react()],
  // `shared` is a linked workspace package whose ESM entries re-export CJS
  // sources; linked deps skip prebundling by default, which would break the
  // dev server's CJS interop. Builds and vitest handle it either way.
  optimizeDeps: {
    include: [
      'shared/time',
      'shared/pitch',
      'shared/registration',
      'shared/announcement',
      'shared/richText',
      'shared/config',
      'shared/routing',
      'shared/page',
      'shared/profile',
      'shared/badges',
      'shared/speaker',
      'shared/theme',
      'shared/presetRemaps',
      'shared/urlSafety',
      'shared/venue',
      'shared/update',
      'shared/seed',
      'shared/slug',
      'shared/email',
      'shared/readiness',
      'shared/speakerReadiness',
    ],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              debugName: 'initial',
              name: (id, context) =>
                !/\.css(\?|$)/.test(id) && staticImportGraph(context).has(id) ? 'initial' : null,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@generated': generatedDir,
      '@': path.resolve(here, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
