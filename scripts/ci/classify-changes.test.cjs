'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { changedPaths, classifyPaths, JOB_NAMES } = require('./classify-changes.cjs');

function selected(result) {
  return JOB_NAMES.filter((name) => result.jobs[name]);
}

test('docs-only changes select documentation checks and the copy gate', () => {
  const result = classifyPaths([
    'README.md',
    'docs/DEPLOY_RUNBOOK.md',
    'docs/handbook/faq.md',
    'CONTRIBUTING.md',
  ]);

  assert.equal(result.mode, 'docs');
  assert.deepEqual(selected(result), ['docs', 'lint']);
  assert.equal(result.jobs.demo, false);
  assert.equal(result.jobs.audit, false);
  assert.equal(result.jobs.unit, false);
  assert.equal(result.jobs.unitWeb, false);
  assert.equal(result.jobs.rules, false);
  assert.equal(result.jobs.e2e, false);
});

test('a document a unit test reads also selects the unit tier', () => {
  // functions/src/users/records.test.cjs reads the admin guide, and
  // scripts/lib/tokens.test.cjs reads the font licence table.
  const guide = classifyPaths(['docs/ADMIN_GUIDE.md']);
  assert.equal(guide.mode, 'docs');
  assert.deepEqual(selected(guide), ['docs', 'lint', 'unit']);
  assert.deepEqual(selected(classifyPaths(['apps/web/public/fonts/README.md'])), ['docs', 'unit']);
});

test('demo generator and committed Pages output select demo checks without emulator suites', () => {
  const generator = classifyPaths([
    'scripts/build-demo.cjs',
    'scripts/build-demo.test.cjs',
  ]);
  const output = classifyPaths(['docs/demo/index.html']);

  assert.equal(generator.mode, 'demo');
  // scripts/** tests that npm test runs read the generators, so unit runs too.
  assert.deepEqual(selected(generator), ['demo', 'lint', 'audit', 'unit']);
  assert.equal(generator.jobs.rules, false);
  assert.equal(generator.jobs.e2e, false);

  assert.equal(output.mode, 'demo');
  assert.deepEqual(selected(output), ['demo']);
});

test('Pages generation and publication select site evidence without emulator suites', () => {
  for (const path of [
    'scripts/build-pages.cjs',
    'scripts/build-pages.test.cjs',
    'scripts/lib/pages-index.cjs',
    'scripts/lib/pages-manifest.cjs',
    'scripts/lib/pages-public-files.cjs',
    'scripts/lib/markdown-pages.cjs',
    'scripts/check-docs.cjs',
    'scripts/check-docs.test.cjs',
    'scripts/stage-pages.cjs',
    'scripts/stage-pages.test.cjs',
    'scripts/dev/check-public-site.mjs',
  ]) {
    const result = classifyPaths([path]);
    assert.equal(result.mode, 'docs', path);
    assert.deepEqual(selected(result), ['docs', 'demo', 'lint', 'audit', 'unit'], path);
    assert.equal(result.jobs.rules, false, path);
    assert.equal(result.jobs.e2e, false, path);
  }
});

test('public HTML, scripts, styles, and media select the site browser check', () => {
  const publicFiles = [
    'docs/features/index.html',
    'docs/how-it-works/index.html',
    'docs/docs/index.html',
    'docs/docs/handbook/for-attendees/index.html',
    'docs/site.js',
    'docs/docs-ui.js',
    'docs/scroll-regions.js',
    'docs/styles.css',
    'docs/docs.css',
    'docs/tokens.css',
    'docs/fonts/bricolage-grotesque-latin-variable.woff2',
    'docs/assets/brand.svg',
    'docs/videos/general-trailer-landscape.png',
    'docs/videos/general-trailer-landscape.mp4',
  ];
  for (const path of publicFiles) {
    const result = classifyPaths([path]);
    assert.equal(result.mode, 'docs', path);
    assert.deepEqual(selected(result), ['docs', 'demo'], path);
  }
  // The homepage retains its existing copy gate as well.
  assert.deepEqual(selected(classifyPaths(['docs/index.html'])), ['docs', 'demo', 'lint']);
});

test('repository-only design notes and screenshots keep the documentation-only tier', () => {
  for (const path of [
    'docs/pr-evidence/pr-811/home.png',
    'docs/plans/evidence/capture.png',
    'docs/design/reference.svg',
    'docs/testing/fixture.html',
  ]) {
    assert.deepEqual(selected(classifyPaths([path])), ['docs'], path);
  }
});

test('the Pages site address selects both the documentation and the demo checks', () => {
  for (const path of ['scripts/lib/pages-site.cjs', 'scripts/lib/pages-site.test.cjs']) {
    const result = classifyPaths([path]);
    assert.equal(result.mode, 'mixed', path);
    assert.deepEqual(selected(result), ['docs', 'demo', 'lint', 'audit', 'unit'], path);
    assert.equal(result.jobs.e2e, false, path);
  }
});

test('application and backend changes select their relevant suites', () => {
  const app = classifyPaths(['apps/web/src/App.jsx']);
  const backend = classifyPaths(['functions/src/core/auth.cjs']);
  const shared = classifyPaths(['packages/shared/src/registration.cjs']);

  assert.equal(app.mode, 'app');
  // npm test files read apps/web (seed and route checks, the bundle budget).
  assert.deepEqual(selected(app), ['demo', 'lint', 'audit', 'unit', 'unitWeb', 'build', 'hygiene', 'e2e']);
  assert.equal(app.jobs.rules, false);

  assert.equal(backend.mode, 'backend');
  assert.deepEqual(selected(backend), ['lint', 'audit', 'unit', 'rules', 'e2e']);
  assert.equal(backend.jobs.unitWeb, false);
  assert.equal(backend.jobs.build, false);

  assert.equal(shared.mode, 'shared');
  assert.deepEqual(selected(shared), [
    'demo',
    'lint',
    'audit',
    'unit',
    'unitWeb',
    'build',
    'hygiene',
    'rules',
    'e2e',
  ]);
});

test('PR change collection uses the merge base and retains both sides of renames', () => {
  let invocation;
  const paths = changedPaths('abcdef1', '1234567', (command, args, options) => {
    invocation = { command, args, options };
    return Buffer.from('docs/old-guide.md\0apps/web/src/Guide.jsx\0');
  });

  assert.deepEqual(paths, ['docs/old-guide.md', 'apps/web/src/Guide.jsx']);
  assert.deepEqual(selected(classifyPaths(paths)), [
    'docs',
    'demo',
    'lint',
    'audit',
    'unit',
    'unitWeb',
    'build',
    'hygiene',
    'e2e',
  ]);
  assert.equal(invocation.command, 'git');
  assert.deepEqual(invocation.args, [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    'abcdef1...1234567',
  ]);
  assert.deepEqual(invocation.options, { encoding: 'buffer' });
});

test('the documentation and gate jobs retain their required checks', () => {
  const workflowPath = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /if \[ -f scripts\/build-pages\.cjs \]; then\s+test -f scripts\/build-pages\.test\.cjs\s+node --test scripts\/build-pages\.test\.cjs/s);
  assert.doesNotMatch(workflow, /if \[ -f scripts\/build-pages\.test\.cjs \]; then/);
  assert.match(workflow, /git show "\$GITHUB_BASE_SHA:scripts\/ci\/classify-changes\.cjs"/);
  assert.doesNotMatch(workflow, /run: node scripts\/ci\/classify-changes\.cjs/);
  // The gate and DCO verdicts are required checks. A pull request must not
  // be able to replace the scripts that decide them (#354), so both load
  // the copy from the base commit, as the classifier does.
  const gate = workflow.slice(workflow.indexOf('\n  gate:'));
  assert.match(gate, /fetch-depth: 0/);
  assert.match(gate, /git show "\$GITHUB_BASE_SHA:scripts\/ci\/verify-gate\.cjs"/);
  assert.doesNotMatch(workflow, /run: node scripts\/ci\/verify-gate\.cjs/);
  const dco = workflow.slice(workflow.indexOf('\n  dco:'), workflow.indexOf('\n  secrets:'));
  assert.match(dco, /git show "\$GITHUB_BASE_SHA:scripts\/check-dco\.cjs"/);
  assert.doesNotMatch(dco, /run: node scripts\/check-dco\.cjs/);
});

test('a cancelled run still evaluates the required gate', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const gate = workflow.slice(workflow.indexOf('\n  gate:'));
  assert.match(gate, /if: \$\{\{ always\(\) \}\}/);
});

test('workflow, configuration, and dependency changes select the full matrix', () => {
  for (const path of [
    '.github/workflows/ci.yml',
    'package-lock.json',
    'firebase.json',
    'apps/web/vite.config.js',
    'apps/web/vite.config.ts',
    'vitest.rules.config.js',
  ]) {
    const result = classifyPaths([path]);
    assert.equal(result.mode, 'full', path);
    assert.deepEqual(selected(result), JOB_NAMES, path);
  }
});

test('mixed changes take the union of their tiers', () => {
  const result = classifyPaths([
    'README.md',
    'apps/web/src/App.jsx',
    'firestore.rules',
  ]);

  assert.equal(result.mode, 'mixed');
  assert.deepEqual(selected(result), [
    'docs',
    'demo',
    'lint',
    'audit',
    'unit',
    'unitWeb',
    'build',
    'hygiene',
    'rules',
    'e2e',
  ]);
});

test('unknown paths fail open to the full matrix', () => {
  const result = classifyPaths(['scripts/new-tool.cjs']);

  assert.equal(result.mode, 'full');
  assert.deepEqual(selected(result), JOB_NAMES);
});

test('a rules file also selects the unit tier, because unit tests read it', () => {
  for (const path of ['firestore.rules', 'storage.rules']) {
    const result = classifyPaths([path]);
    assert.equal(result.mode, 'rules', path);
    assert.deepEqual(selected(result), ['unit', 'rules', 'e2e'], path);
  }
});

test('a rules test file selects the rules suite and lint, not the full matrix', () => {
  const result = classifyPaths(['tests/firestore.rules.test.js']);
  assert.equal(result.mode, 'rules');
  assert.deepEqual(selected(result), ['lint', 'rules']);
  // Anything else under tests/ is unknown and still fails open.
  assert.equal(classifyPaths(['tests/helpers/new.js']).mode, 'full');
});

test('the two longest suites run in shards, and each shard is told its slice', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = (name, next) => workflow.slice(workflow.indexOf(`\n  ${name}:`), workflow.indexOf(`\n  ${next}:`));

  const e2e = job('e2e', 'gate');
  assert.match(e2e, /strategy:\s+fail-fast: false\s+matrix:\s+shard: \[1, 2, 3\]/);
  assert.match(e2e, /PLAYWRIGHT_SHARD: \$\{\{ matrix\.shard \}\}\/3/);
  // The demo evidence is one job's work, not three.
  for (const step of ['demo_builds', 'demo_visuals']) {
    const at = e2e.indexOf(`id: ${step}`);
    assert.match(e2e.slice(at, at + 200), /matrix\.shard == 1/, step);
  }
  // Artifact names must differ per shard, or the uploads collide.
  assert.match(e2e, /name: admin-visual-evidence-\$\{\{ matrix\.shard \}\}/);
  assert.match(e2e, /name: playwright-report-\$\{\{ matrix\.shard \}\}/);

  const web = job('unit-web', 'build');
  assert.match(web, /strategy:\s+fail-fast: false\s+matrix:\s+shard: \[1, 2\]/);
  assert.match(web, /npm run test -w apps\/web -- --shard=\$\{\{ matrix\.shard \}\}\/2/);
});

test('public site evidence runs once in the demo tier with a built demo and sandboxed browser', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = (name, next) => workflow.slice(workflow.indexOf(`\n  ${name}:`), workflow.indexOf(`\n  ${next}:`));
  const demo = job('demo', 'rules');
  const e2e = job('e2e', 'gate');

  assert.match(demo, /if: needs\.changes\.outputs\.demo == 'true' && needs\.changes\.outputs\.local != 'true'/);
  assert.match(demo, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(demo, /setup-java|firebase\/emulators|run-e2e\.sh|matrix\.shard|continue-on-error: true/);
  assert.match(demo, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"/);
  assert.match(demo, /key: playwright-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('node_modules\/@playwright\/test\/package\.json'\) \}\}/);
  assert.match(demo, /npx playwright install --with-deps chromium/);
  assert.match(demo, /CHROME_DEVEL_SANDBOX: \/opt\/eventrunner-chromium-sandbox/);
  assert.match(demo, /sudo install -o root -g root -m 4755 "\$helper" "\$CHROME_DEVEL_SANDBOX"/);

  // The reproducibility check removes both its scratch output and dist.
  // A regular build must follow it before link checks can serve docs/demo.
  const hygieneAt = demo.indexOf('run: node scripts/build-demo.cjs --check');
  const buildAt = demo.indexOf('run: node scripts/build-demo.cjs\n');
  const browserAt = demo.indexOf('run: node scripts/dev/check-public-site.mjs');
  assert.ok(hygieneAt >= 0 && buildAt > hygieneAt && browserAt > buildAt);
  assert.equal((workflow.match(/run: node scripts\/dev\/check-public-site\.mjs/g) || []).length, 1);
  assert.doesNotMatch(e2e, /public_site_evidence|public-site-visual-evidence|check-public-site\.mjs/);

  // Failed captures remain available, while the failure still blocks CI.
  assert.match(demo, /always\(\).*steps\.public_site_evidence\.outcome == 'failure'.*steps\.public_site_evidence\.outcome == 'cancelled'/);
  assert.match(demo, /name: public-site-visual-evidence\s+path: test-results\/public-site-evidence\/\s+if-no-files-found: error/);
});

test('the browser suite runner passes a shard to Playwright only when one is set', () => {
  const runner = fs.readFileSync(path.resolve(__dirname, '..', 'dev', 'run-e2e.sh'), 'utf8');
  assert.match(runner, /"npx playwright test\$\{PLAYWRIGHT_SHARD:\+ --shard=\$PLAYWRIGHT_SHARD\}"/);
});

test('the client console routes to its own suites, never the event site’s browser suite', () => {
  const web = classifyPaths(['console/web/src/pages/Team.jsx']);
  assert.equal(web.mode, 'console');
  assert.deepEqual(selected(web), ['lint', 'audit', 'unitWeb', 'build']);

  const backend = classifyPaths(['console/functions/src/invites.cjs']);
  assert.deepEqual(selected(backend), ['lint', 'audit', 'unit']);

  assert.deepEqual(selected(classifyPaths(['console/firestore.rules'])), ['rules']);
  assert.deepEqual(selected(classifyPaths(['console/tests/console.rules.test.js'])), ['lint', 'rules']);
  assert.deepEqual(selected(classifyPaths(['console/firebase.json'])), ['build', 'rules']);
  // Its docs are docs, and its package and tool files still fail open.
  assert.equal(classifyPaths(['console/README.md']).mode, 'docs');
  // check-copy-style.cjs scans it, so a change to it must select the copy gate.
  assert.deepEqual(selected(classifyPaths(['console/README.md'])), ['docs', 'lint']);
  assert.equal(classifyPaths(['console/web/package.json']).mode, 'full');
  assert.equal(classifyPaths(['console/web/vite.config.js']).mode, 'full');
});

test('the console web tests and build run in CI', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = (name, next) => workflow.slice(workflow.indexOf(`\n  ${name}:`), workflow.indexOf(`\n  ${next}:`));
  const web = job('unit-web', 'build');
  assert.match(web, /if: matrix\.shard == 1\s+run: npm run test:console/);
  const build = job('build', 'hygiene');
  assert.match(build, /npm run build:console/);
  assert.match(build, /test -f console\/web\/dist\/index\.html/);
});
