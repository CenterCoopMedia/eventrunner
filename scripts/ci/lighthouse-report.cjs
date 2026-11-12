#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ci } = require('./lighthouserc.cjs');

const METRICS = ['largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift'];
const route = (url) => { const parsed = new URL(url); return `${parsed.pathname}${parsed.hash}`; };

/** Each metric uses its own median, matching LHCI's median assertions. */
function summarize(reports) {
  const groups = new Map(ci.collect.url.map((url) => [route(url), []]));
  for (const report of reports) {
    const name = route(report.requestedUrl);
    if (!groups.has(name)) throw new Error(`Unexpected Lighthouse route: ${name}`);
    if (report.runtimeError) throw new Error(`${name}: ${report.runtimeError.message}`);
    if (report.configSettings?.formFactor !== 'mobile') throw new Error(`${name}: Expected a mobile report.`);
    if (route(report.finalDisplayedUrl || report.finalUrl) !== name) throw new Error(`${name}: Lighthouse ended on another route.`);
    for (const metric of METRICS) {
      const value = report.audits?.[metric]?.numericValue;
      if (!Number.isFinite(value) || value < 0) throw new Error(`${name}: Missing or invalid ${metric}.`);
    }
    groups.get(name).push(report);
  }
  return [...groups].map(([name, runs]) => {
    if (runs.length !== ci.collect.numberOfRuns) throw new Error(`${name}: Expected ${ci.collect.numberOfRuns} runs; received ${runs.length}.`);
    const medians = METRICS.map((metric) => runs.map((run) => run.audits[metric].numericValue).sort((a, b) => a - b)[Math.floor(runs.length / 2)]);
    return { route: name, runs: runs.length, lcp: medians[0], tbt: medians[1], cls: medians[2] };
  });
}

function markdown(rows) {
  return [
    '## Lighthouse mobile demo', '',
    '| Route | Runs | Median LCP (ms) | Median TBT (ms) | Median CLS |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${row.route} | ${row.runs} | ${Math.round(row.lcp)} | ${row.tbt.toFixed(1)} | ${row.cls.toFixed(4)} |`),
    '', 'Lab results cover the static demo. TBT is a lab proxy; these results do not measure field INP or live Firestore/image-manifest latency.', '',
  ].join('\n');
}

if (require.main === module) {
  try {
    const directory = '.lighthouseci';
    const reports = fs.readdirSync(directory).filter((name) => /^lhr-.*\.json$/.test(name))
      .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
    const rows = summarize(reports);
    const summary = markdown(rows);
    fs.writeFileSync(path.join(directory, 'summary.json'), `${JSON.stringify(rows, null, 2)}\n`);
    fs.writeFileSync(path.join(directory, 'summary.md'), summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.stdout.write(summary);
  } catch (error) {
    console.error(`Lighthouse summary: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { summarize, markdown };
