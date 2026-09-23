// Reusable PR-evidence screenshot spec (see capture.sh in this same
// directory for how it gets run).
//
// This file is not meant to live in the repo's own e2e/ suite. capture.sh
// copies it into <worktree>/e2e/zz-capture.spec.mjs so it runs through the
// same Playwright config (globalSetup, webServer, baseURL) and the same
// `firebase emulators:exec` wrapping scripts/dev/run-e2e.sh uses, then
// deletes the copy — nothing here should be committed.
//
// INPUT: two env vars, both set by capture.sh.
//
//   CAPTURE_PLAN     path to a JSON file: either an array of entries, or
//                    `{ "entries": [...] }`. See the entry shape below.
//   CAPTURE_OUT_DIR  directory PNGs are written into (created if missing).
//
// PLAN ENTRY SHAPE (all but name/path are optional):
//
//   {
//     "name": "admin-event-settings-social-add",   // used in the filename
//     "path": "/admin/settings",                    // route, passed to page.goto
//     "role": "admin" | "anon",                      // default "anon"
//     "widths": [1440, 390],                         // default [1440]
//     "modes": ["light", "dark"],                    // default ["light"]
//     "height": 1080,                                 // optional viewport height
//     "selector": "section:has(h2:text-is(\"Places\"))", // capture just this
//                                                          // element (auto-scrolled
//                                                          // into view) instead of
//                                                          // the viewport
//     "fullPage": false,                             // capture the whole
//                                                     // scrollable page instead
//                                                     // of just the viewport;
//                                                     // ignored when `selector`
//                                                     // is set. Keep this false
//                                                     // unless you really need
//                                                     // the whole page — full
//                                                     // pages make large PNGs.
//     "skipUnless": {                                // optional: skip this
//       "doc": "config/event",                       // entry (all its
//       "field": "social.handles",                   // width/mode jobs) unless
//       "nonEmpty": true                              // a Firestore field says
//     },                                              // otherwise. Checked at
//                                                      // test run time, i.e.
//                                                      // after the suite has
//                                                      // seeded the emulator.
//     "actions": [ ... ]                             // see below; run in
//                                                     // order after the page
//                                                     // settles and before
//                                                     // the screenshot
//   }
//
// "admin" signs in once (through the real /signin OTP form, reading the
// code from the captured-mail file exactly like e2e/otp-signin.spec.js) as
// the seeded e2e admin (e2e-admin@example.test — see e2e/global-setup.mjs)
// and reuses that session for every admin entry. "anon" reuses one signed-
// out context for every anon entry. Both stay open for the whole run so
// switching between entries never costs a re-login.
//
// Every job (one per entry × mode × width) does a fresh `page.goto` to
// `path` — a real navigation, so React state from a previous job never
// leaks in — then waits for the page to settle, then runs `actions` in
// order, then takes the screenshot. Mode is applied with
// `page.emulateMedia({ colorScheme })`, so a site whose dark mode follows
// `prefers-color-scheme` (config/theme.mode === 'system' here; see
// apps/web/src/lib/modeRuntime.js) picks it up live; a site pinned to
// 'light' or 'dark' will just render the same either way, which is exactly
// the fact the tool is meant to surface, not paper over.
//
// ACTIONS — small, generic primitives; the plan JSON carries all the
// page-specific knowledge (selectors, values), not this file:
//
//   { "type": "click",         "locator": "...", "options"?: {...} }
//   { "type": "fill",          "locator": "...", "value": "...", "options"?: {...} }
//   { "type": "press",         "locator": "...", "key": "Enter" }
//   { "type": "check"   / "uncheck", "locator": "..." }
//   { "type": "selectOption",  "locator": "...", "value": "..." }
//   { "type": "hover",         "locator": "..." }
//   { "type": "scrollIntoView","locator": "..." }
//   { "type": "waitFor",       "locator": "...", "state"?: "visible", "timeout"?: 5000 }
//   { "type": "wait",          "ms": 300 }
//   { "type": "expect",        "locator": "...", "matcher": "not.toHaveValue",
//                               "args"?: [""], "timeout"?: 5000 }
//
// `locator` is any Playwright selector string — plain CSS, or an engine-
// prefixed one (`role=button[name="Add account"]`, `text=Enter the full
// link`, `css=...`). The role engine's `[name=...]` matches the element's
// accessible name, which for a labelled admin field (a real <label for>,
// see apps/web/src/admin/components/formControls.jsx TextField) is that
// label's text — so `role=textbox[name="Account 1 link"]` finds the input
// under the "Account 1 link" label without needing a test id.
//
// `matcher` for the "expect" action is a (possibly dotted, e.g.
// "not.toHaveValue") path into Playwright's `expect(locator)` assertion
// object; `args` are passed to the final matcher call.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, adminDb, mailFileSize, waitForOtpCode } from './helpers.mjs';

const PLAN_PATH = process.env.CAPTURE_PLAN;
if (!PLAN_PATH) {
  throw new Error(
    'capture.spec.mjs: CAPTURE_PLAN is not set — point it at a plan JSON file (see capture.sh).',
  );
}
if (!fs.existsSync(PLAN_PATH)) {
  throw new Error(`capture.spec.mjs: CAPTURE_PLAN (${PLAN_PATH}) does not exist.`);
}
const OUT_DIR = process.env.CAPTURE_OUT_DIR
  || path.resolve(process.cwd(), 'e2e/.tmp/capture-out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const planRaw = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
const planEntries = Array.isArray(planRaw) ? planRaw : planRaw.entries;
if (!Array.isArray(planEntries)) {
  throw new Error(`capture.spec.mjs: ${PLAN_PATH} must be a JSON array, or {"entries": [...]}.`);
}

/** One job per entry × mode × width — each becomes its own Playwright test. */
function expandJobs(entries) {
  const jobs = [];
  entries.forEach((entry, entryIndex) => {
    if (!entry || !entry.name || !entry.path) {
      throw new Error(
        `capture.spec.mjs: entry ${entryIndex} in ${PLAN_PATH} needs at least "name" and "path".`,
      );
    }
    const modes = entry.modes?.length ? entry.modes : ['light'];
    const widths = entry.widths?.length ? entry.widths : [1440];
    for (const mode of modes) {
      for (const width of widths) {
        jobs.push({
          testTitle: `${entry.name} · ${mode} · ${width}`,
          name: entry.name,
          path: entry.path,
          role: entry.role === 'admin' ? 'admin' : 'anon',
          mode,
          width,
          height: entry.height || (width <= 500 ? 900 : 1080),
          selector: entry.selector || null,
          fullPage: entry.fullPage === true,
          actions: Array.isArray(entry.actions) ? entry.actions : [],
          skipUnless: entry.skipUnless || null,
        });
      }
    }
  });
  return jobs;
}

/**
 * Whether a job's `skipUnless` condition holds. Reads straight from the
 * emulator (helpers.mjs's adminDb()), so this reflects what THIS run's
 * global-setup actually seeded, not an assumption baked into the plan file.
 * Called from inside each test body — never at module load — because
 * globalSetup (which does the seeding) has not necessarily run yet when
 * Playwright first imports this file to enumerate its tests.
 *
 * @returns {Promise<string|null>} a skip reason, or null to run the job
 */
async function skipReasonFor(cond) {
  if (!cond) return null;
  const slash = cond.doc.indexOf('/');
  const collection = cond.doc.slice(0, slash);
  const docId = cond.doc.slice(slash + 1);
  const snap = await adminDb().collection(collection).doc(docId).get();
  const data = snap.data() ?? {};
  const value = cond.field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
  const isEmpty = !Array.isArray(value) || value.length === 0;
  if (cond.nonEmpty && isEmpty) {
    return `${cond.doc} field "${cond.field}" is empty in this project — nothing to capture.`;
  }
  return null;
}

/** Sign in through the real /signin form, exactly like e2e/otp-signin.spec.js. */
async function signInAsAdmin(page) {
  const since = mailFileSize();
  await page.goto('/signin');
  const emailInput = page.locator('#signin-email');
  await emailInput.waitFor({ state: 'visible' });
  await emailInput.fill(ADMIN_EMAIL);
  await page.getByRole('button', { name: /email me a code/i }).click();
  const codeInput = page.locator('#signin-code');
  await codeInput.waitFor({ state: 'visible' });
  const code = await waitForOtpCode(since, ADMIN_EMAIL, 30_000);
  await codeInput.fill(code);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => url.pathname !== '/signin');
}

/**
 * Best-effort "the page has finished its first paint of real data" wait.
 * Generic on purpose — a plan's own `actions` (e.g. an "expect" that a
 * specific field is non-empty) carry any page-specific readiness check.
 */
async function waitForSettle(page) {
  // Suspense/loading fallbacks in this app render role="status" (see
  // apps/web/src/admin/components/adminChrome.jsx AdminLoadingState).
  const status = page.locator('[role="status"]').first();
  try {
    await status.waitFor({ state: 'visible', timeout: 800 });
    await status.waitFor({ state: 'hidden', timeout: 20_000 });
  } catch {
    // Never appeared, or already gone — either way, nothing to wait out.
  }
  // Public pages mark when the live cmsContent overlay (vs. the build-time
  // snapshot) has resolved — see e2e/cms-publish.spec.js and Home.jsx.
  const live = page.locator('[data-content-source="live"]').first();
  try {
    await live.waitFor({ state: 'visible', timeout: 4000 });
  } catch {
    // Not that kind of page.
  }
  try {
    await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  } catch {
    // Non-fatal — keep going even if a browser doesn't support this.
  }
  await page.waitForTimeout(250);
}

function mergeOptions(action) {
  return action.timeout ? { ...(action.options ?? {}), timeout: action.timeout } : action.options;
}

async function runAction(page, action) {
  const locator = action.locator ? page.locator(action.locator) : null;
  const options = mergeOptions(action);
  switch (action.type) {
    case 'click':
      await locator.click(options);
      return;
    case 'fill':
      await locator.fill(action.value ?? '', options);
      return;
    case 'press':
      await locator.press(action.key, options);
      return;
    case 'check':
      await locator.check(options);
      return;
    case 'uncheck':
      await locator.uncheck(options);
      return;
    case 'selectOption':
      await locator.selectOption(action.value, options);
      return;
    case 'hover':
      await locator.hover(options);
      return;
    case 'scrollIntoView':
      await locator.scrollIntoViewIfNeeded(options);
      return;
    case 'waitFor':
      await locator.waitFor({ state: action.state ?? 'visible', timeout: action.timeout });
      return;
    case 'wait':
      await page.waitForTimeout(action.ms ?? 0);
      return;
    case 'expect': {
      const args = [...(action.args ?? [])];
      if (action.timeout) args.push({ timeout: action.timeout });
      let assertion = expect(locator);
      const parts = action.matcher.split('.');
      for (let i = 0; i < parts.length - 1; i += 1) assertion = assertion[parts[i]];
      await assertion[parts[parts.length - 1]](...args);
      return;
    }
    default:
      throw new Error(`capture.spec.mjs: unknown action type "${action.type}".`);
  }
}

const jobs = expandJobs(planEntries);

test.describe.serial('PR evidence capture', () => {
  test.setTimeout(90_000);
  /** One shared context+page per role, opened lazily, reused for every job. */
  const shared = {};

  async function pageFor(browser, role) {
    if (role === 'admin') {
      if (!shared.adminPage) {
        shared.adminContext = await browser.newContext({
          viewport: { width: 1440, height: 1080 },
          deviceScaleFactor: 1,
        });
        shared.adminPage = await shared.adminContext.newPage();
        await signInAsAdmin(shared.adminPage);
      }
      return shared.adminPage;
    }
    if (!shared.anonPage) {
      shared.anonContext = await browser.newContext({
        viewport: { width: 1440, height: 1080 },
        deviceScaleFactor: 1,
      });
      shared.anonPage = await shared.anonContext.newPage();
    }
    return shared.anonPage;
  }

  test.afterAll(async () => {
    await shared.adminContext?.close().catch(() => {});
    await shared.anonContext?.close().catch(() => {});
  });

  for (const job of jobs) {
    test(job.testTitle, async ({ browser }) => {
      const skipReason = await skipReasonFor(job.skipUnless);
      test.skip(!!skipReason, skipReason ?? '');

      const page = await pageFor(browser, job.role);
      await page.setViewportSize({ width: job.width, height: job.height });
      await page.emulateMedia({ colorScheme: job.mode === 'dark' ? 'dark' : 'light' });
      await page.goto(job.path);
      await waitForSettle(page);
      for (const action of job.actions) await runAction(page, action);

      const outFile = path.join(OUT_DIR, `${job.name}--${job.mode}--${job.width}.png`);
      if (job.selector) {
        const target = page.locator(job.selector).first();
        await target.scrollIntoViewIfNeeded();
        await expect(target).toBeVisible();
        await target.screenshot({ path: outFile });
      } else {
        await page.screenshot({ path: outFile, fullPage: job.fullPage });
      }
    });
  }
});
