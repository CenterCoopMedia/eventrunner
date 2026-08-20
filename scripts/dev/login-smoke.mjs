#!/usr/bin/env node
'use strict';

/**
 * Live smoke test for the emailed-code sign-in flow (M2 tranche 4 done-when).
 *
 * Drives the real Login page against a running Vite dev server and Firebase
 * emulators (functions, firestore, auth) with the console email provider —
 * no real email is sent; the six-digit code is scraped from the functions
 * emulator's stdout log, which the console provider writes to.
 *
 * Prerequisites (all credential-free / demo-project):
 *   firebase emulators:start --only functions,firestore,auth \
 *     --project demo-run-of-show
 *   (with EVENT_FIREBASE_PROJECT_ID=demo-run-of-show, EVENT_EMAIL_PROVIDER=console,
 *    FUNCTIONS_EMULATOR=true, EVENT_ALLOWED_ORIGINS including the dev origin)
 *   vite dev (or preview) with VITE_USE_EMULATORS=true and
 *     VITE_FUNCTIONS_ORIGIN=http://127.0.0.1:5001/demo-run-of-show/us-central1
 *
 * Usage:
 *   node scripts/dev/login-smoke.mjs \
 *     --app-url http://127.0.0.1:5173/signin \
 *     --emulator-log /path/to/emulator-stdout.log
 *
 * Exits 0 and prints "SMOKE OK" when the app reaches signed-in state; exits
 * 1 with a diagnostic otherwise. Requires the `playwright` package and a
 * Chromium binary (PLAYWRIGHT_BROWSERS_PATH) — never runs `playwright
 * install`; if the browser is missing, fails fast with a clear message
 * instead of attempting a network install.
 */

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {
    appUrl: 'http://127.0.0.1:5173/signin',
    emulatorLog: null,
    email: `login-smoke-${Date.now()}@example.test`,
    timeoutMs: 30000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--app-url') out.appUrl = argv[++i];
    else if (a === '--emulator-log') out.emulatorLog = argv[++i];
    else if (a === '--email') out.email = argv[++i];
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
  }
  return out;
}

/**
 * Scrape the most recent 6-digit OTP code sent to `email` out of the
 * console-provider log. The provider writes one `[email:console] {...}` JSON
 * blob per send, containing `to` and `text`/`html` with the code embedded.
 */
function scrapeCodeFromLog(logText, email) {
  // firebase-tools prefixes every line of a function's captured stdout with
  // "> " when it forwards it to the emulator log — strip that before
  // treating the block as JSON.
  const cleaned = logText
    .split('\n')
    .map((line) => line.replace(/^>\s*/, ''))
    .join('\n');
  const marker = '[email:console]';
  const blocks = cleaned.split(marker).slice(1);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const chunk = blocks[i];
    // The JSON blob runs until the next unindented log line or EOF; grab the
    // first balanced-looking JSON object greedily via matching braces.
    const start = chunk.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    let end = -1;
    for (let j = start; j < chunk.length; j += 1) {
      if (chunk[j] === '{') depth += 1;
      else if (chunk[j] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) continue;
    let parsed;
    try {
      parsed = JSON.parse(chunk.slice(start, end + 1));
    } catch {
      continue;
    }
    if (parsed.to !== email) continue;
    const haystack = `${parsed.text || ''} ${parsed.html || ''}`;
    const match = haystack.match(/\b(\d{6})\b/);
    if (match) return match[1];
  }
  return null;
}

async function waitFor(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out waiting for ${label}${lastErr ? `: ${lastErr.message}` : ''}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let playwright;
  try {
    // Prefer a workspace-local install; fall back to the environment's
    // global playwright (this box ships one at /opt/node22 with a
    // pre-fetched Chromium under PLAYWRIGHT_BROWSERS_PATH).
    playwright = await import('playwright');
  } catch {
    try {
      playwright = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
    } catch (err) {
      console.error('SMOKE SKIPPED: playwright is not available and this script must not run `playwright install`.');
      console.error(String(err));
      process.exitCode = 1;
      return;
    }
  }

  const { chromium } = playwright;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  try {
    await page.goto(args.appUrl, { waitUntil: 'load' });

    const emailInput = page.locator('#signin-email');
    await emailInput.waitFor({ state: 'visible', timeout: args.timeoutMs });
    await emailInput.fill(args.email);
    await page.locator('button[type="submit"]', { hasText: /email me a code/i }).click();

    // Step 2: the code input appears once sendOtpCode resolves.
    await page.locator('#signin-code').waitFor({ state: 'visible', timeout: args.timeoutMs });

    if (!args.emulatorLog || !fs.existsSync(args.emulatorLog)) {
      throw new Error(`--emulator-log not found: ${args.emulatorLog}`);
    }
    const code = await waitFor(
      () => scrapeCodeFromLog(fs.readFileSync(args.emulatorLog, 'utf8'), args.email),
      { timeoutMs: args.timeoutMs, label: 'the OTP code to appear in the emulator log' },
    );

    await page.locator('#signin-code').fill(code);
    await page.locator('button[type="submit"]', { hasText: /^sign in$/i }).click();

    // A successful verify signs the user in via signInWithCustomToken and
    // Login.jsx navigates to "/" immediately (spec: no dead-end sign-in
    // page). Confirm the redirect landed, then revisit /signin — with the
    // Firebase Auth session already established, AuthContext's
    // onAuthStateChanged renders the "you are signed in" branch without any
    // further form interaction, which is the real assertion that signed-in
    // state stuck.
    await page.waitForURL(/\/$/, { timeout: args.timeoutMs });
    await page.goto(args.appUrl, { waitUntil: 'load' });
    await page.getByText(/you are signed in/i).waitFor({ state: 'visible', timeout: args.timeoutMs });

    if (consoleErrors.length) {
      throw new Error(`page threw uncaught errors: ${consoleErrors.join('; ')}`);
    }

    console.log('SMOKE OK — reached signed-in state for', args.email);
    process.exitCode = 0;
  } catch (err) {
    console.error('SMOKE FAILED:', err.message);
    try {
      const shotPath = path.join(path.dirname(args.emulatorLog || '.'), 'login-smoke-failure.png');
      await page.screenshot({ path: shotPath });
      console.error('screenshot saved to', shotPath);
    } catch {
      // best-effort
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
