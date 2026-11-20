// Vite config for the client console web app (ADR 0007 §1). It builds to
// console/web/dist, which only console/firebase.json serves.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@screenshot-ui': fileURLToPath(new URL('../../packages/shared/src/screenshot-ui', import.meta.url)) },
  },
  // The dev server serves the CommonJS shared package without interop unless
  // it is prebundled. src/optimizeDeps.test.js keeps this list complete.
  optimizeDeps: { include: ['shared/consoleRequest'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Keep the lazy Setup route within its per-chunk budget.
            {
              name: 'setup-steps',
              test: /[\\/]src[\\/]setup[\\/]StepList\.jsx$/,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
