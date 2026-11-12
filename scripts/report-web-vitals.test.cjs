'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readArgs, seededRecords, formatReport, main } = require('./report-web-vitals.cjs');

const RECORDS = [{
  route: '/',
  device: 'desktop',
  counts: {
    LCP: { 25: 3, 26: 1 },
    INP: { 20: 2, 21: 2 },
    LCP_TTFB: { 8: 4 },
    held_up: { 1: 3 },
  },
}];

test('arguments choose one explicit seeded or project source', () => {
  assert.deepEqual(readArgs(['--input', '-']), { project: null, input: '-' });
  assert.deepEqual(readArgs(['--input', 'vitals.json']), { project: null, input: 'vitals.json' });
  assert.deepEqual(readArgs(['--project', 'event-project']), { project: 'event-project', input: null });
  for (const argv of [
    [],
    ['--input'],
    ['--project'],
    ['--input', '-', '--project', 'event-project'],
    ['--input', 'a.json', '--input', 'b.json'],
    ['--live'],
  ]) assert.throws(() => readArgs(argv));
});

test('seed input accepts the documented array and records wrapper only', () => {
  assert.deepEqual(seededRecords(JSON.stringify(RECORDS)), RECORDS);
  assert.deepEqual(seededRecords(JSON.stringify({ records: RECORDS })), RECORDS);
  for (const value of ['{}', 'null', '"records"']) assert.throws(() => seededRecords(value));
});

test('the seeded report prints bucket p75 bounds, good thresholds, LCP parts, and held-up count', () => {
  const lines = formatReport(RECORDS).split('\n');
  assert.equal(lines[0], 'route\tdevice\tmetric\tsamples\tp75 upper bound\tgood threshold\trating');
  assert.ok(lines.includes('/\tdesktop\tLCP\t4\t2500 ms\t<= 2500 ms\tgood'));
  assert.ok(lines.includes('/\tdesktop\tINP\t4\t210 ms\t<= 200 ms\tneeds improvement'));
  assert.ok(lines.includes('/\tdesktop\tLCP_TTFB\t4\t800 ms\t-\t-'));
  assert.ok(lines.includes('/\tdesktop\theld_up\t3\t-\t-\t-'));
  assert.equal(lines.length, 5);
});

test('the CLI reads the same seeded JSON from stdin and a file without initializing ADC', (t) => {
  const script = path.join(__dirname, 'report-web-vitals.cjs');
  const input = JSON.stringify(RECORDS);
  const stdin = spawnSync(process.execPath, [script, '--input', '-'], { input, encoding: 'utf8' });
  assert.equal(stdin.status, 0, stdin.stderr);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-vitals-report-'));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const file = path.join(dir, 'seed.json');
  fs.writeFileSync(file, input);
  const fromFile = spawnSync(process.execPath, [script, '--input', file], { encoding: 'utf8' });
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.equal(fromFile.stdout, stdin.stdout);
});

test('project mode delegates one current-retention read to the named project', async () => {
  const seen = [];
  const output = [];
  const code = await main(['--project', 'event-project'], {
    projectReader: async (projectId) => { seen.push(projectId); return RECORDS; },
    stdout: (line) => output.push(line),
    stderr: (line) => output.push(line),
  });
  assert.equal(code, 0);
  assert.deepEqual(seen, ['event-project']);
  assert.equal(output.join('\n'), formatReport(RECORDS));
});
