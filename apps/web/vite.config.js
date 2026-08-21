// Vite config for the attendee/admin frontend (spec §1.2).
//
// GENERATED_DIR: deploy-time generation (scripts/generate-content.cjs, §8.6)
// writes snapshot files to an out-of-tree directory instead of overwriting
// the committed synthetic demo copy. The build reads that directory when the
// GENERATED_DIR env var is set; otherwise it uses the committed snapshot in
// src/generated — which is what keeps CI credential-free (§8.1).
//
// Every source import of snapshot data goes through the `@generated` alias
// so the override applies to the whole app, theme.css included.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = process.env.GENERATED_DIR
  ? path.resolve(process.env.GENERATED_DIR)
  : path.resolve(here, 'src/generated');

export default defineConfig({
  plugins: [react()],
  // `shared` is a linked workspace package whose ESM entries re-export CJS
  // sources; linked deps skip prebundling by default, which would break the
  // dev server's CJS interop. Builds and vitest handle it either way.
  optimizeDeps: {
    include: [
      'shared/time',
      'shared/registration',
      'shared/config',
      'shared/routing',
      'shared/profile',
      'shared/badges',
      'shared/urlSafety',
    ],
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
