'use strict';

// Run the same selected tiers as Actions. Keep the receipt outside the worktree.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { classifyEvent, JOB_NAMES } = require('./classify-changes.cjs');
const { statusContext } = require('./local-results.cjs');

const CHECKS = {
  docs: [
    ['node', 'scripts/check-docs.cjs'],
    ['node', '--test', 'scripts/check-docs.test.cjs', 'scripts/build-pages.test.cjs'],
  ],
  demo: [
    ['node', '--test', 'scripts/build-demo.test.cjs'],
    ['node', 'scripts/build-demo.cjs', '--check'],
    ['node', 'scripts/ci/bundle-budget.cjs', '--dist', 'docs/demo'],
  ],
  lint: [['npm', 'run', 'lint'], ['npm', 'run', 'check:copy']],
  audit: [['node', 'scripts/ci/audit-policy.cjs']],
  unit: [['node', '--test', '--test-concurrency=2', 'packages/shared/src/**/*.test.cjs', 'functions/src/**/*.test.cjs', 'scripts/**/*.test.cjs']],
  unitWeb: [['npm', 'run', 'test', '-w', 'apps/web', '--', '--maxWorkers=2']],
  build: [['npm', 'run', 'build'], ['node', 'scripts/ci/bundle-budget.cjs', '--dist', 'apps/web/dist']],
  hygiene: [['node', 'scripts/generate-content.cjs', '--demo', '--check']],
  rules: [['npm', 'run', 'test:rules']],
  e2e: [['bash', 'scripts/dev/run-e2e.sh']],
};

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function snapshot(base) {
  const head = git('rev-parse', 'HEAD');
  statusContext(base);
  git('merge-base', '--is-ancestor', base, head);
  if (git('status', '--porcelain')) throw new Error('Local CI requires a clean worktree');
  return { base, head, tree: git('rev-parse', 'HEAD^{tree}') };
}

function runChecks(base, report) {
  if (process.versions.node.split('.')[0] !== '22') throw new Error('Use Node 22 for local CI');
  const before = snapshot(base);
  const { jobs } = classifyEvent({ eventName: 'pull_request', base, head: before.head });
  const env = {
    ...process.env,
    CI: 'true',
    VITE_FIREBASE_API_KEY: 'ci-dummy-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'ci-dummy.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'ci-dummy',
    VITE_FIREBASE_STORAGE_BUCKET: 'ci-dummy.appspot.com',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
    VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
  };
  const receipt = { version: 1, ...before, startedAt: new Date().toISOString(), results: {} };
  fs.writeFileSync(report, `${JSON.stringify(receipt, null, 2)}\n`);
  for (const name of JOB_NAMES) {
    if (!jobs[name]) continue;
    console.log(`Local CI: ${name}`);
    for (const [command, ...args] of CHECKS[name]) {
      execFileSync(command, args, { env, stdio: 'inherit' });
    }
    receipt.results[name] = 'success';
    fs.writeFileSync(report, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  if (JSON.stringify(snapshot(base)) !== JSON.stringify(before)) {
    throw new Error('The tested tree changed during local CI');
  }
  receipt.completedAt = new Date().toISOString();
  fs.writeFileSync(report, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Local CI passed for ${before.head}; receipt: ${report}`);
}

function validateReceipt(receipt, current, jobs, now = Date.now()) {
  if (receipt.version !== 1 || !receipt.completedAt ||
      ['base', 'head', 'tree'].some((key) => receipt[key] !== current[key]) ||
      JOB_NAMES.some((name) => jobs[name] && receipt.results?.[name] !== 'success')) {
    throw new Error('Receipt does not prove the selected checks passed for this tree and base');
  }
  const age = now - Date.parse(receipt.startedAt);
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) {
    throw new Error('Local CI receipt is expired or invalid');
  }
}

function publishResult(base, report, repository) {
  const current = snapshot(base);
  const receipt = JSON.parse(fs.readFileSync(report, 'utf8'));
  const { jobs } = classifyEvent({ eventName: 'pull_request', base, head: current.head });
  validateReceipt(receipt, current, jobs);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Set --repo owner/name');
  execFileSync('gh', ['api', '--method', 'POST', `repos/${repository}/statuses/${current.head}`, '--input', '-'], {
    input: JSON.stringify({
      context: statusContext(base),
      state: 'success',
      description: 'Selected local CI tiers passed on the exact head and base.',
      target_url: `https://github.com/${repository}/commit/${current.head}`,
    }),
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  console.log(`Published local CI result for ${current.head}`);
}

function main() {
  const { values } = parseArgs({ options: {
    base: { type: 'string' }, report: { type: 'string' },
    publish: { type: 'boolean', default: false }, repo: { type: 'string' },
  } });
  if (!values.base || !values.report) throw new Error('Use --base <full SHA> --report <outside-worktree.json>');
  if (values.publish) publishResult(values.base, values.report, values.repo);
  else runChecks(values.base, values.report);
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`Local CI failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { CHECKS, publishResult, runChecks, snapshot, validateReceipt };
