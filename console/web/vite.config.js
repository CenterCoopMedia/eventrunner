// Vite config for the client console web app (ADR 0007 §1). It builds to
// console/web/dist, which only console/firebase.json serves.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The dev server serves the CommonJS shared package without interop unless
  // it is prebundled. src/optimizeDeps.test.js keeps this list complete.
  optimizeDeps: { include: ['shared/consoleRequest'] },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
