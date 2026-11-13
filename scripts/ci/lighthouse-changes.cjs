'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');

function isLighthouseInput(file) {
  if (['package.json', '.npmrc', '.github/workflows/lighthouse.yml',
    'scripts/build-demo.cjs', 'scripts/write-site-files.cjs'].includes(file)) return true;
  if (/^scripts\/ci\/lighthouse/.test(file)) return true;
  if (/\.(?:test\.[^/]+|md)$/.test(file)) return false;
  return file.startsWith('scripts/lib/') || file.startsWith('packages/shared/') ||
    file.startsWith('design/tokens/') ||
    (file.startsWith('apps/web/') && !file.startsWith('apps/web/src/admin/') && !file.startsWith('apps/web/src/test/'));
}

// These are workspace manifest records, not installed packages. Keep every
// node_modules record: even a Console update can change a hoisted web dependency.
function webLockfile(lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error('Expected a version 3 workspace lockfile');
  }
  const packages = { ...lock.packages };
  for (const workspace of ['console/functions', 'console/web', 'functions']) delete packages[workspace];
  return { ...lock, packages };
}

function shouldMeasure({ eventName, base, head, runGit = execFileSync }) {
  if (!['pull_request', 'push'].includes(eventName) || /^0+$/.test(base || '')) return true;
  if (!/^[0-9a-f]{40}$/.test(base || '') || !/^[0-9a-f]{40}$/.test(head || '')) {
    throw new Error('Expected base and head commit IDs');
  }
  const git = (...args) => runGit('git', args, { encoding: 'utf8' });
  const start = eventName === 'pull_request' ? git('merge-base', base, head).trim() : base;
  const paths = git('diff', '--name-only', '-z', '--no-renames', start, head).split('\0').filter(Boolean);
  if (paths.some(isLighthouseInput)) return true;
  if (!paths.includes('package-lock.json')) return false;
  const readLock = (ref) => webLockfile(JSON.parse(git('show', `${ref}:package-lock.json`)));
  return !isDeepStrictEqual(readLock(start), readLock(head));
}

function main(env = process.env) {
  const measure = shouldMeasure({ eventName: env.GITHUB_EVENT_NAME, base: env.BASE_SHA, head: env.HEAD_SHA });
  fs.appendFileSync(env.GITHUB_OUTPUT, `measure=${measure}\n`);
  console.log(`Lighthouse web inputs changed: ${measure}`);
}

if (require.main === module) main();

module.exports = { isLighthouseInput, webLockfile, shouldMeasure };
