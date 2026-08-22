// Playwright config for the e2e suite (issue #38, spec §8.1).
//
// Dev server vs. preview (judgment call): `apps/web/src/firebase.js` only
// connects to the Auth/Firestore/Storage emulators when
// `import.meta.env.DEV && VITE_USE_EMULATORS === 'true'` — `import.meta.env.DEV`
// is `false` in a production build (`vite build` + `vite preview`), so a
// preview server would silently talk to production Firebase endpoints that
// do not exist in this credential-free CI run. The dev server is therefore
// the only server this app's own emulator wiring supports; see
// apps/web/README.md "Dev loop" for the same env vars used interactively.
//
// This config never runs `playwright install` (spec: pre-installed Chromium
// only, PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers locally; the CI workflow
// installs its own copy explicitly — see .github/workflows/ci.yml `e2e`).
import { defineConfig, devices } from '@playwright/test';

const APP_URL = process.env.E2E_APP_URL || 'http://127.0.0.1:5173';
const PROJECT_ID = process.env.EVENT_FIREBASE_PROJECT_ID || 'demo-run-of-show';
const REGION = process.env.EVENT_FIREBASE_REGION || 'us-central1';

export default defineConfig({
  testDir: './e2e',
  // The four journeys share one seeded emulator project (config/bootstrap,
  // the demo fixture's speakers/sessions) — running spec files in parallel
  // would race writes to that shared state, so the whole suite is serial.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  globalSetup: './e2e/global-setup.mjs',
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // --host 127.0.0.1 pins the bind address explicitly. Without it, Vite 5
    // binds "localhost", and on ubuntu-latest runners Node's DNS resolution
    // of "localhost" can land on ::1 while Playwright's own webServer probe
    // (and baseURL/APP_URL above) hit 127.0.0.1 — a bind/probe mismatch that
    // reads as a plain timeout ("Timed out waiting ... from
    // config.webServer") with no other clue, since the server logs "ready"
    // regardless. Binding and probing the SAME literal address removes the
    // ambiguity instead of papering over it with a longer timeout.
    command: 'npm run dev -w apps/web -- --host 127.0.0.1 --port 5173 --strictPort',
    url: APP_URL,
    reuseExistingServer: !process.env.CI,
    // Modest headroom for a cold CI cache (first Vite dependency
    // pre-bundle) — the bind fix above is the actual cure; this alone
    // would not have helped a mismatched bind that never becomes reachable.
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Non-secret client config pointed at the emulators (apps/web/README.md
      // "Dev loop"). VITE_USE_EMULATORS + import.meta.env.DEV (true under
      // `vite`) is what src/firebase.js gates the emulator connection on.
      VITE_FIREBASE_API_KEY: 'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
      VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
      VITE_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
      VITE_FIREBASE_REGION: REGION,
      VITE_USE_EMULATORS: 'true',
      VITE_FUNCTIONS_ORIGIN: `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}`,
    },
  },
});
