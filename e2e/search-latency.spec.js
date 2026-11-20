// Search and long-list latency baseline (issue #1135).
//
// Production timing evidence only. This spec builds the real Schedule and
// Attendees pages in production mode (the app-boot fixture pattern), feeds
// them deterministic synthetic data, and records trusted keyboard input at
// 4x Chromium CPU throttling. The emulator journeys elsewhere in e2e/ run on
// the Vite development server: they prove behavior, and their timing is not
// production performance.
//
// It asserts that each action reached its expected state, never a latency
// budget. The numbers are evidence for #1136 and #1137, written to
// test-results/search-latency-evidence/ with a Chrome trace per run.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'apps/web/test-fixtures/search-latency');
const SOURCES = path.join(FIXTURE, 'sources');
const EVIDENCE = path.join(ROOT, 'test-results/search-latency-evidence');
const CPU_THROTTLING = 4;
const TYPING_DELAY_MS = 120;
const QUIET_MS = 300;
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
// The fixture swaps only these data-source modules; every component is real.
const STUBS = new Map(['firebase', 'lib/firebaseLoader', 'lib/bookmarkCountsSource', 'lib/profileSource']
  .map((name) => [path.join(ROOT, `apps/web/src/${name}.js`), path.join(SOURCES, `${path.basename(name)}.js`)]));

let server;
let output;
let origin;
let source;
let fixtureData;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const { build, preview } = await import('vite');
  const { default: appConfig } = await import('../apps/web/vite.config.js');
  fixtureData = await import('../apps/web/test-fixtures/search-latency/data.js');
  const html = await fs.readFile(path.join(ROOT, 'apps/web/index.html'), 'utf8');
  await fs.writeFile(path.join(FIXTURE, 'index.html'), html.replace('src="/src/main.jsx"', 'src="/main.jsx"'));
  output = await fs.mkdtemp(path.join(os.tmpdir(), 'eventrunner-search-latency-'));
  const app = appConfig({ command: 'build', mode: 'production', isSsrBuild: false });
  // The real stylesheet, with Tailwind's content globs anchored to apps/web
  // (they are relative to the working directory, which is the repository).
  const { default: tailwindcss } = await import('tailwindcss');
  const { default: autoprefixer } = await import('autoprefixer');
  const { default: tailwindConfig } = await import('../apps/web/tailwind.config.js');
  const web = path.join(ROOT, 'apps/web');
  const content = [path.join(web, 'index.html'), path.join(web, 'src/**/*.{js,jsx}'), `!${path.join(web, 'src/**/*.test.{js,jsx}')}`];
  const sourceSwap = {
    name: 'search-latency-sources',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (!importer || importer.startsWith(SOURCES)) return null;
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
      return resolved && STUBS.get(resolved.id.split('?')[0]) || null;
    },
  };
  const config = {
    ...app,
    plugins: [sourceSwap, ...app.plugins],
    configFile: false,
    mode: 'production',
    root: FIXTURE,
    base: '/',
    publicDir: path.join(ROOT, 'apps/web/public'),
    logLevel: 'error',
    css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig, content }), autoprefixer()] } },
    build: { ...app.build, outDir: output, emptyOutDir: true },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  };
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await build(config);
    server = await preview(config);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await fs.rm(path.join(FIXTURE, 'index.html'), { force: true });
  }
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  source = {
    checkout: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    githubSha: process.env.GITHUB_SHA ?? null,
    githubRef: process.env.GITHUB_REF ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
  };
  await fs.mkdir(EVIDENCE, { recursive: true });
});

test.afterAll(async () => {
  await new Promise((resolve, reject) => server ? server.httpServer.close((error) => error ? reject(error) : resolve()) : resolve());
  if (output) await fs.rm(output, { recursive: true, force: true });
});

// Installed before any page script. Event Timing reports interactions at or
// above its 16 ms floor only, so trusted inputs are counted separately and an
// input with no entry is reported as missing, never as zero.
async function installRecorder(page, resultsSelector) {
  await page.addInitScript((selector) => {
    const record = { action: null, actions: [] };
    globalThis.latencyRecord = record;
    const current = () => record.action;
    // An observer can deliver an entry after the next action began, so each
    // entry goes to the action whose window contains its start time.
    const actionAt = (time) => record.actions.findLast((action) => action.startedAt <= time) ?? null;
    for (const type of ['keydown', 'pointerdown']) {
      globalThis.addEventListener(type, (event) => {
        const action = current();
        if (action && event.isTrusted) action.inputs.push({ type, key: event.key ?? null, at: event.timeStamp });
      }, { capture: true });
    }
    // Text can arrive with no keydown (an accented character is inserted as
    // text). Input events anchor the settle time; they are not interactions.
    globalThis.addEventListener('input', (event) => {
      const action = current();
      if (action && event.isTrusted) action.textInputs.push(event.timeStamp);
    }, { capture: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const action = actionAt(entry.startTime);
        if (!action) continue;
        action.events.push({
          name: entry.name, interactionId: entry.interactionId, startTime: entry.startTime, duration: entry.duration,
          processingStart: entry.processingStart, processingEnd: entry.processingEnd,
        });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const action = actionAt(entry.startTime);
        if (action) {
          action.shifts.push({ value: entry.value, hadRecentInput: entry.hadRecentInput, startTime: entry.startTime });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const action = actionAt(entry.startTime);
        if (!action) continue;
        action.frames.push({
          startTime: entry.startTime, duration: entry.duration, blockingDuration: entry.blockingDuration,
          renderStart: entry.renderStart, styleAndLayoutStart: entry.styleAndLayoutStart,
          scripts: entry.scripts.map((script) => ({
            invoker: script.invoker, invokerType: script.invokerType, duration: script.duration,
            forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
    // The end of the frame that rendered the last change to the results or
    // the count line.
    globalThis.addEventListener('DOMContentLoaded', () => {
      new globalThis.MutationObserver((mutations) => {
        const action = current();
        if (!action) return;
        const relevant = mutations.some(({ target }) => {
          const element = target.nodeType === 1 ? target : target.parentElement;
          return element?.closest(`${selector}, [role="status"]`);
        });
        if (!relevant) return;
        const mutation = performance.now();
        action.lastMutation = mutation;
        // A task posted from requestAnimationFrame runs after that frame's
        // style, layout and paint, so the stamp includes the rendering work.
        globalThis.requestAnimationFrame(() => {
          const channel = new globalThis.MessageChannel();
          channel.port1.onmessage = () => {
            if (action.lastMutation === mutation) action.settledFrame = performance.now();
          };
          channel.port2.postMessage(null);
        });
      }).observe(globalThis.document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    });
  }, resultsSelector);
}

async function startAction(page, label) {
  await page.evaluate((name) => {
    const action = { label: name, startedAt: performance.now(), inputs: [], textInputs: [], events: [], shifts: [], frames: [],
      lastMutation: null, settledFrame: null };
    globalThis.latencyRecord.action = action;
    globalThis.latencyRecord.actions.push(action);
  }, label);
}

async function settle(page, ready, label, consistent) {
  await expect.poll(async () => (await ready()) && (await consistent(page)) && page.evaluate((quiet) => {
    const action = globalThis.latencyRecord.action;
    // An action that changes no result (opening the filter panel) settles
    // after the same quiet period and reports no settle time.
    if (action.lastMutation === null) return performance.now() - action.startedAt >= quiet;
    return action.settledFrame !== null && performance.now() - action.lastMutation >= quiet;
  }, QUIET_MS), { message: `"${label}" reached its state and the results went quiet`, timeout: 15_000 }).toBe(true);
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

function summarize(action, resultNodes) {
  const keyInputs = action.inputs.filter(({ type }) => type === 'keydown');
  const interactions = new Map();
  for (const entry of action.events) {
    if (!entry.interactionId) continue;
    interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration));
  }
  const durations = [...interactions.values()];
  const anchors = [...action.inputs.map(({ at }) => at), ...action.textInputs].sort((a, b) => a - b);
  const first = anchors[0] ?? null;
  const last = anchors.at(-1) ?? null;
  const sum = (list, pickValue) => list.reduce((total, item) => total + pickValue(item), 0);
  return {
    label: action.label,
    trustedInputs: action.inputs.length,
    keydowns: keyInputs.length,
    textInputs: action.textInputs.length,
    eventTimingInteractions: durations.length,
    // Inputs below the 16 ms reporting floor, or never reported, are absent.
    missingEventTimingSamples: Math.max(0, action.inputs.length - durations.length),
    inputToNextPaintMs: { max: durations.length ? Math.max(...durations) : null, p75: percentile(durations, 0.75), samples: durations },
    resultSettleMs: {
      fromFirstInput: first === null || action.settledFrame === null ? null : action.settledFrame - first,
      fromLastInput: last === null || action.settledFrame === null ? null : action.settledFrame - last,
    },
    layoutShift: {
      total: sum(action.shifts, ({ value }) => value),
      withoutRecentInput: sum(action.shifts.filter(({ hadRecentInput }) => !hadRecentInput), ({ value }) => value),
      entries: action.shifts.length,
    },
    longAnimationFrames: {
      count: action.frames.length,
      totalMs: sum(action.frames, ({ duration }) => duration),
      blockingMs: sum(action.frames, ({ blockingDuration }) => blockingDuration),
      scriptMs: sum(action.frames, ({ scripts }) => sum(scripts, ({ duration }) => duration)),
      // Render covers style, layout and paint preparation for the frame.
      renderMs: sum(action.frames, (frame) => (frame.renderStart ? frame.startTime + frame.duration - frame.renderStart : 0)),
      styleAndLayoutMs: sum(action.frames, (frame) => (frame.styleAndLayoutStart ? frame.startTime + frame.duration - frame.styleAndLayoutStart : 0)),
      frames: action.frames,
    },
    resultElementCount: resultNodes,
  };
}

async function measure(browser, { name, viewport, url, resultsSelector, ready, consistent, actions }) {
  const context = await browser.newContext({ viewport: VIEWPORTS[viewport], reducedMotion: 'no-preference' });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  const blocked = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });
  await page.route('**/*', (route) => {
    const requestUrl = route.request().url();
    if (new URL(requestUrl).origin === origin) return route.continue();
    blocked.push(requestUrl);
    return route.abort();
  });
  await installRecorder(page, resultsSelector);
  const tracePath = path.join(EVIDENCE, `search-latency-${name}-${viewport}.trace.json`);
  try {
    await page.goto(`${origin}${url}`);
    await ready(page).catch((error) => { throw new Error(`${error.message}\nPage errors: ${pageErrors.join('\n') || 'none'}`); });
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLING });
    await browser.startTracing(page, { path: tracePath, screenshots: false,
      categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'latencyInfo', 'v8.execute', 'disabled-by-default-v8.cpu_profiler'] });
    const results = [];
    let failure = null;
    try {
      for (const action of actions) {
        const before = await searchBox(page).inputValue();
        if (action.available && !(await action.available(page))) {
          // Lost input can leave nothing to clear. Say so; do not invent a step.
          results.push({ label: action.label, skipped: 'the control was not on the page', field: { before } });
          continue;
        }
        await startAction(page, action.label);
        try {
          await action.run(page);
          await settle(page, () => action.done(page), action.label, consistent);
        } catch (error) {
          // Keep what was measured and the page's view for the report.
          failure = { action: action.label, message: error.message.split('\n')[0], view: await page.evaluate(() => ({
            search: globalThis.location.search, field: globalThis.document.querySelector('input[type="search"]')?.value ?? null,
            statuses: [...globalThis.document.querySelectorAll('[role="status"]')].map((node) => node.textContent),
          })) };
          break;
        }
        const record = await page.evaluate(() => globalThis.latencyRecord.action);
        const nodes = await page.evaluate((selector) => [...globalThis.document.querySelectorAll(selector)]
          .reduce((total, element) => total + element.querySelectorAll('*').length, 0), resultsSelector);
        const kept = await searchBox(page).inputValue();
        const field = action.intended
          ? { before, intended: action.intended(before), kept, lostInput: kept !== action.intended(before) }
          : { before, kept };
        results.push({ ...summarize(record, nodes), field, url: new URL(page.url()).search });
      }
    } finally {
      await browser.stopTracing();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    const report = {
      issue: 1135,
      page: name,
      buildMode: 'production',
      source,
      browser: { name: 'chromium', version: browser.version() },
      fixture: { seed: fixtureData.FIXTURE_SEED, sessions: fixtureData.fixture.scheduleData.length,
        directoryEntries: fixtureData.fixture.directory.length, denseDay: fixtureData.DENSE_DAY },
      viewport: { name: viewport, ...VIEWPORTS[viewport] },
      cpuThrottling: CPU_THROTTLING,
      typingDelayMs: TYPING_DELAY_MS,
      settleQuietMs: QUIET_MS,
      eventTimingThresholdMs: 16,
      actionSequence: actions.map(({ label }) => label),
      blockedExternalRequests: blocked,
      pageErrors,
      trace: path.basename(tracePath),
      actions: results,
      failure,
    };
    await fs.writeFile(path.join(EVIDENCE, `search-latency-${name}-${viewport}.json`), `${JSON.stringify(report, null, 2)}\n`);
    expect(failure).toBeNull();
    expect(blocked).toEqual([]);
    expect(pageErrors).toEqual([]);
    return report;
  } finally {
    await context.close();
  }
}

// One synchronous read: a locator can wait on a line that changes under it.
const statusText = (page) => page.evaluate(() => [...globalThis.document.querySelectorAll('[role="status"]')]
  .map((node) => node.textContent).find((text) => text.includes('match')) ?? '');
const searchBox = (page) => page.getByRole('searchbox');
// Typing records what the reader meant and what the field kept. A field fed
// from a lagging URL can drop keystrokes; the baseline reports that instead
// of waiting for text that never arrives.
const type = (text) => ({ run: (page) => searchBox(page).pressSequentially(text, { delay: TYPING_DELAY_MS }),
  intended: (before) => before + text });
const erase = (count) => ({ run: async (page) => {
  for (let index = 0; index < count; index += 1) await searchBox(page).press('Backspace', { delay: TYPING_DELAY_MS });
}, intended: (before) => before.slice(0, -count) });
const clearButton = (page) => page.getByRole('button', { name: 'Clear search' });
const clearSearch = { run: (page) => clearButton(page).press('Enter'), intended: () => '',
  available: async (page) => (await clearButton(page).count()) > 0 };
// The count line describes the text the field holds now.
const inSync = async (page) => {
  const value = (await searchBox(page).inputValue()).trim();
  const line = await statusText(page);
  return value ? line.includes(`“${value}”`) : !line.includes('“');
};
const search = (label, step) => ({ label, ...step, done: inSync });

// The URL commits at once; the page renders it later. An action settles only
// when the rendered field, count line, facets and sort all show the URL, so
// the next action never starts from a view the reader has not seen.
const scheduleRendered = (page) => page.evaluate(() => {
  const params = new URL(globalThis.location.href).searchParams;
  const q = (params.get('q') ?? '').trim();
  const formats = (params.get('format') ?? '').split(',').filter(Boolean);
  const field = globalThis.document.querySelector('input[type="search"]')?.value.trim() ?? '';
  const line = [...globalThis.document.querySelectorAll('[role="status"]')].map((node) => node.textContent).find((text) => text.includes('match')) ?? '';
  const sort = globalThis.document.querySelector('select')?.value ?? 'time';
  const checked = [...globalThis.document.querySelectorAll('.schedule-facets input[type="checkbox"]:checked')].length;
  const lineAgrees = q ? line.includes(`“${q}”`) : formats.length ? line.includes('selected filters') : line === '';
  return field === q && lineAgrees && sort === (params.get('sort') ?? 'time') && checked === formats.length;
});

function scheduleActions(viewport) {
  const facet = (page) => page.getByRole('checkbox', { name: /^workshop \(\d+\)$/ });
  const openFilters = viewport === 'phone'
    ? [{ label: 'open filters', run: (page) => page.getByRole('button', { name: /^Filters/ }).press('Enter'),
      done: async (page) => facet(page).isVisible() }]
    : [];
  const sort = (page) => page.getByRole('combobox', { name: 'Sort sessions' });
  return [
    search('type "data"', type('data')),
    search('delete two characters', erase(2)),
    search('clear search', clearSearch),
    search('type zero-match "zzqx"', type('zzqx')),
    search('clear zero-match search', clearSearch),
    ...openFilters,
    { label: 'check workshop facet', run: (page) => facet(page).press('Space'),
      done: async (page) => new URL(page.url()).searchParams.get('format') === 'workshop' },
    { label: 'uncheck workshop facet', run: (page) => facet(page).press('Space'),
      done: async (page) => !new URL(page.url()).searchParams.has('format') },
    { label: 'sort most saved', run: (page) => sort(page).press('ArrowDown'),
      done: async (page) => new URL(page.url()).searchParams.get('sort') === 'saved' },
    { label: 'sort by time', run: (page) => sort(page).press('ArrowUp'),
      done: async (page) => !new URL(page.url()).searchParams.has('sort') },
  ];
}

function attendeeActions() {
  const facet = (page) => page.getByRole('group', { name: 'Organization' }).getByRole('checkbox').first();
  return [
    search('type "mar" (dense M group)', type('mar')),
    search('delete three characters', erase(3)),
    search('type duplicate name "maria garcia"', type('maria garcia')),
    search('clear search', clearSearch),
    search('type accented "josé"', type('josé')),
    search('clear accented search', clearSearch),
    search('type zero-match "zzqx"', type('zzqx')),
    search('clear zero-match search', clearSearch),
    { label: 'check top organization', run: (page) => facet(page).press('Space'), done: async (page) => facet(page).isChecked() },
    { label: 'uncheck top organization', run: (page) => facet(page).press('Space'), done: async (page) => !(await facet(page).isChecked()) },
  ];
}

for (const viewport of Object.keys(VIEWPORTS)) {
  test(`schedule search on the dense day at ${viewport} width, production build`, async ({ browser }) => {
    test.setTimeout(120_000);
    const report = await measure(browser, {
      name: 'schedule', viewport, url: `/schedule?day=${fixtureData.DENSE_DAY}`,
      // The day section, which survives a grid to list switch.
      resultsSelector: 'section[aria-labelledby^="day-"]',
      ready: (page) => expect(page.locator('[data-schedule-results]')).toBeVisible(),
      consistent: scheduleRendered,
      actions: scheduleActions(viewport),
    });
    expect(report.actions.filter(({ skipped }) => !skipped).every(({ trustedInputs }) => trustedInputs > 0)).toBe(true);
  });

  test(`attendee directory search at ${viewport} width, production build`, async ({ browser }) => {
    test.setTimeout(120_000);
    const report = await measure(browser, {
      name: 'attendees', viewport, url: '/attendees',
      resultsSelector: '.attendee-index',
      ready: (page) => expect(page.locator('.attendee-index li').first()).toBeVisible(),
      consistent: inSync,
      actions: attendeeActions(),
    });
    expect(report.actions.filter(({ skipped }) => !skipped).every(({ trustedInputs }) => trustedInputs > 0)).toBe(true);
  });
}
