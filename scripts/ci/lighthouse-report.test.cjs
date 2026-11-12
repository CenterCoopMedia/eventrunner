'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { summarize } = require('./lighthouse-report.cjs');

// Field names follow the recorded Lighthouse 13.6 reports. The independent
// arithmetic example is median(300, 100, 200) = 200 for each route.
function reports() {
  return ['/', '/#/schedule', '/#/speakers'].flatMap((route) => [300, 100, 200].map((value) => ({
    requestedUrl: `http://localhost:1234${route}`,
    finalUrl: 'http://localhost:1234/',
    finalDisplayedUrl: `http://localhost:1234${route}`,
    configSettings: { formFactor: 'mobile' },
    audits: {
      'largest-contentful-paint': { numericValue: value },
      'total-blocking-time': { numericValue: value / 10 },
      'cumulative-layout-shift': { numericValue: value / 10000 },
    },
  })));
}

test('groups hash routes separately and takes each metric median', () => {
  assert.deepEqual(summarize(reports()), ['/', '/#/schedule', '/#/speakers'].map((route) => ({
    route, runs: 3, lcp: 200, tbt: 20, cls: 0.02,
  })));
});

test('rejects an incomplete collection rather than publishing a partial median', () => {
  assert.throws(() => summarize(reports().slice(1)), /Expected 3 runs; received 2/);
});

test('rejects a runtime failure even when a report has numeric audit values', () => {
  const runs = reports();
  runs[0].runtimeError = { message: 'Page did not load' };
  assert.throws(() => summarize(runs), /Page did not load/);
});

test('rejects the wrong route or device mode', () => {
  const runs = reports();
  runs[3].finalDisplayedUrl = 'http://localhost:1234/';
  assert.throws(() => summarize(runs), /ended on another route/);
  runs[3].finalDisplayedUrl = runs[3].requestedUrl;
  runs[3].configSettings.formFactor = 'desktop';
  assert.throws(() => summarize(runs), /Expected a mobile report/);
});

test('rejects a missing metric rather than treating it as zero', () => {
  const runs = reports();
  delete runs[0].audits['total-blocking-time'];
  assert.throws(() => summarize(runs), /Missing or invalid total-blocking-time/);
});

test('writes the JSON and Markdown artifacts and appends the job summary', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lighthouse-report-'));
  try {
    const output = path.join(directory, '.lighthouseci');
    fs.mkdirSync(output);
    reports().forEach((report, index) => fs.writeFileSync(path.join(output, `lhr-${index}.json`), JSON.stringify(report)));
    const jobSummary = path.join(directory, 'job-summary.md');
    fs.writeFileSync(jobSummary, 'Existing job summary\n');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'lighthouse-report.cjs')], {
      cwd: directory, env: { ...process.env, GITHUB_STEP_SUMMARY: jobSummary }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'summary.json'), 'utf8')).length, 3);
    assert.match(fs.readFileSync(path.join(output, 'summary.md'), 'utf8'), /\/#\/schedule \| 3 \| 200 \| 20\.0 \| 0\.0200/);
    assert.match(fs.readFileSync(jobSummary, 'utf8'), /^Existing job summary\n## Lighthouse mobile demo/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
