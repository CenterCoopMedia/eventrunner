'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const JOB_NAMES = Object.freeze([
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

const DEMO_GENERATOR_PATHS = new Set([
  'scripts/build-demo.cjs',
  'scripts/build-demo.test.cjs',
]);

const DOCS_GENERATOR_PATHS = new Set([
  'scripts/build-pages.cjs',
  'scripts/build-pages.test.cjs',
  'scripts/lib/markdown-pages.cjs',
]);

const COPY_CHECKED_DOC_FILES = new Set([
  'README.md',
  'docs/index.html',
  'docs/ADMIN_GUIDE.md',
  'docs/CLIENT_ONBOARDING.md',
  'docs/DEPLOY_RUNBOOK.md',
  'docs/POSTMARK_PROVISIONING.md',
  'docs/EVENTBRITE_VERIFICATION.md',
]);

const ALWAYS_FULL_PATHS = new Set([
  '.env.example',
  'eslint.config.mjs',
  'firebase.json',
  'firestore.indexes.json',
  'playwright.config.js',
]);

const TOOL_CONFIGURATION_PATH_RE = /(?:^|\/)[^/]+\.config\.(?:[cm]?[jt]s|json|ya?ml|toml)$/;

function normalizePath(value) {
  return String(value)
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '');
}

function uniquePaths(paths) {
  return [...new Set((Array.isArray(paths) ? paths : []).map(normalizePath).filter(Boolean))];
}

function isMarkdownPath(path) {
  return path.endsWith('.md') || path.endsWith('.mdx');
}

function isDemoPath(path) {
  return DEMO_GENERATOR_PATHS.has(path) || path.startsWith('docs/demo/');
}

function isDocsGeneratorPath(path) {
  return DOCS_GENERATOR_PATHS.has(path) || /^scripts\/lib\/pages-[^/]+\.cjs$/.test(path);
}

function isDocsPath(path) {
  if (isDemoPath(path)) return false;
  return isDocsGeneratorPath(path) ||
    isMarkdownPath(path) ||
    path.startsWith('docs/') ||
    path.startsWith('.github/ISSUE_TEMPLATE/') ||
    path.startsWith('.github/DISCUSSION_TEMPLATE/') ||
    path === 'LICENSE' ||
    path === 'NOTICE';
}

function isCopyCheckedDocsPath(path) {
  return COPY_CHECKED_DOC_FILES.has(path) || path.startsWith('docs/handbook/');
}

function isAppPath(path) {
  return path.startsWith('apps/web/') && !isMarkdownPath(path);
}

function isBackendPath(path) {
  return path.startsWith('functions/') && !isMarkdownPath(path);
}

function isSharedPath(path) {
  return path.startsWith('packages/shared/') && !isMarkdownPath(path);
}

function isRulesPath(path) {
  return path === 'firestore.rules' ||
    path === 'storage.rules' ||
    path === 'vitest.rules.config.js';
}

function isFullPath(path) {
  if (ALWAYS_FULL_PATHS.has(path)) return true;
  if (TOOL_CONFIGURATION_PATH_RE.test(path)) return true;
  if (path.startsWith('.github/workflows/')) return true;
  if (path.startsWith('.github/') && !isDocsPath(path)) return true;
  if (path.startsWith('e2e/') || path.startsWith('publisher/')) return true;
  if (isDocsGeneratorPath(path)) return false;
  if (path.startsWith('scripts/') && !DEMO_GENERATOR_PATHS.has(path) && !isMarkdownPath(path)) {
    return true;
  }
  return /(^|\/)package(?:-lock)?\.json$/.test(path);
}

function emptyJobs(value = false) {
  return Object.fromEntries(JOB_NAMES.map((name) => [name, value]));
}

function allJobs() {
  return emptyJobs(true);
}

function resultForPaths(paths, mode, categories) {
  const {
    docs,
    copyDocs,
    demo,
    demoGenerator,
    docsGenerator,
    app,
    backend,
    shared,
    rules,
    full,
  } = categories;
  const jobs = {
    docs: docs || full,
    demo: demo || app || shared || full,
    // Scanned documentation selects this tier so the copy gate cannot be
    // bypassed by a documentation-only pull request.
    lint: copyDocs || demoGenerator || docsGenerator || app || backend || shared || full,
    // The audit policy reads package.json/package-lock.json across the
    // workspace. Documentation copy does not change that dependency surface.
    audit: demoGenerator || docsGenerator || app || backend || shared || full,
    unit: backend || shared || full,
    unitWeb: app || shared || full,
    build: app || shared || full,
    hygiene: app || shared || full,
    rules: rules || backend || shared || full,
    e2e: app || backend || shared || rules || full,
  };
  return { paths, mode, jobs };
}

function classifyPaths(input) {
  const paths = uniquePaths(input);
  if (paths.length === 0) {
    return { paths, mode: 'full', jobs: allJobs() };
  }

  const categories = {
    docs: paths.some(isDocsPath),
    copyDocs: paths.some(isCopyCheckedDocsPath),
    demo: paths.some(isDemoPath),
    demoGenerator: paths.some((path) => DEMO_GENERATOR_PATHS.has(path)),
    docsGenerator: paths.some(isDocsGeneratorPath),
    app: paths.some(isAppPath),
    backend: paths.some(isBackendPath),
    shared: paths.some(isSharedPath),
    rules: paths.some(isRulesPath),
    full: paths.some(isFullPath),
  };

  const recognized = categories.docs || categories.demo || categories.app ||
    categories.backend || categories.shared || categories.rules || categories.full;
  if (!recognized) categories.full = true;

  // A workflow, tool configuration, dependency manifest, or unknown path is
  // deliberately fail-open. Do not describe a full-matrix selection as a
  // mixed tier merely because the same path also belongs to an app or rules
  // directory.
  if (categories.full) return resultForPaths(paths, 'full', categories);

  const categoryNames = [
    ['docs', categories.docs],
    ['demo', categories.demo],
    ['app', categories.app],
    ['backend', categories.backend],
    ['shared', categories.shared],
    ['rules', categories.rules],
    ['full', categories.full],
  ].filter(([, selected]) => selected).map(([name]) => name);
  const mode = categoryNames.length === 1 ? categoryNames[0] : 'mixed';

  return resultForPaths(paths, mode, categories);
}

function changedPaths(base, head, runGit = execFileSync) {
  if (!/^[0-9a-f]{7,64}$/i.test(String(base)) || !/^[0-9a-f]{7,64}$/i.test(String(head))) {
    throw new Error('base and head must be commit ids');
  }
  const output = runGit('git', ['diff', '--name-only', '-z', '--no-renames', `${base}...${head}`], {
    encoding: 'buffer',
  });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function classifyEvent({ eventName, base, head, runGit = execFileSync } = {}) {
  if (eventName !== 'pull_request') {
    return { paths: [], mode: 'full', jobs: allJobs() };
  }
  return classifyPaths(changedPaths(base, head, runGit));
}

function writeOutputs(result, outputPath) {
  if (!outputPath) return;
  const lines = [
    `mode=${result.mode}`,
    `paths=${result.paths.length}`,
    ...JOB_NAMES.map((name) => `${name}=${result.jobs[name]}`),
  ];
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

function main(env = process.env) {
  const result = classifyEvent({
    eventName: env.GITHUB_EVENT_NAME,
    base: env.GITHUB_BASE_SHA,
    head: env.GITHUB_HEAD_SHA,
  });
  writeOutputs(result, env.GITHUB_OUTPUT);
  console.log(`ci changes: ${result.mode}; selected jobs: ${JOB_NAMES.filter((name) => result.jobs[name]).join(', ')}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`ci changes: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  JOB_NAMES,
  allJobs,
  changedPaths,
  classifyEvent,
  classifyPaths,
  isDocsPath,
  isDemoPath,
  main,
};
