#!/usr/bin/env node
'use strict';

/**
 * Static showcase build — the click-through demo published from GitHub Pages
 * at https://centercoopmedia.github.io/run-of-show/demo/.
 *
 * It is the ordinary `vite build` of apps/web with two switches thrown:
 *
 *   VITE_DEMO_MODE=1   apps/web/src/lib/demoMode.js — HashRouter instead of
 *                      BrowserRouter, Firestore taken offline before any
 *                      listener attaches, App Check never initialized, the
 *                      sign-in panel replaced with a "disabled in this demo"
 *                      notice, and the standing demo banner mounted.
 *   --base <path>      asset URLs under the Pages subpath.
 *
 * Nothing here is client-specific and nothing here runs in the per-client
 * pipeline: deploy-client.yml and scripts/publish-site.cjs call the same
 * `npm run build -w apps/web` WITHOUT these switches, so every demo branch
 * compiles away to dead code there and their output is unchanged.
 *
 * The content is the committed synthetic snapshot in apps/web/src/generated
 * (a fictional event, spec §2.4/§5.4). GENERATED_DIR is deliberately NOT
 * honored: pointing this at a real client's Firestore export would publish
 * that client's content into a public repository, which §8.6 exists to
 * prevent. It is cleared for the child process even if the caller set it.
 *
 * Output is synced into docs/demo/ — committed, because GitHub Pages serves
 * this repo from /docs. Stale contents are deleted first so a renamed hashed
 * asset never lingers.
 *
 * Usage:
 *   node scripts/build-demo.cjs                     # build + sync
 *   node scripts/build-demo.cjs --base /other/path/ # different subpath
 *   node scripts/build-demo.cjs --out docs/demo     # different destination
 *   node scripts/build-demo.cjs --dry-run           # print the plan only
 *
 * Exit codes: 0 ok, 1 unexpected error, 2 bad arguments, 4 build failed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web');
const DIST_DIR = path.join(WEB_DIR, 'dist');

/** Pages project site root is /run-of-show/; the demo lives beside the docs. */
const DEFAULT_BASE = '/run-of-show/demo/';
const DEFAULT_OUT = path.join('docs', 'demo');

/**
 * Non-secret placeholders for the six required VITE_FIREBASE_* values.
 *
 * The build reads them (firebase.js calls initializeApp unconditionally), but
 * the demo never reaches the network with them: the Firestore client is taken
 * offline at startup and sign-in is disabled. They exist so this script needs
 * no credentials and no .env — same rationale as the dummy values CI passes
 * for the credential-free build (spec §8.1). The project id is the demo
 * project name the repo already uses everywhere else.
 */
const DEMO_FIREBASE_ENV = Object.freeze({
  VITE_FIREBASE_API_KEY: 'demo-not-a-real-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-run-of-show.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-run-of-show',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-run-of-show.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
});

function parseArgs(argv) {
  const options = { base: DEFAULT_BASE, out: DEFAULT_OUT, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--base' || arg === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new UsageError(`${arg} needs a value.`);
      }
      options[arg === '--base' ? 'base' : 'out'] = value;
      i += 1;
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
    } else if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length);
    } else {
      throw new UsageError(`Unknown argument: ${arg}`);
    }
  }
  // Vite resolves asset URLs by string concatenation against `base`, so a
  // missing trailing slash silently produces `/demo/demoassets/…`.
  if (!options.base.endsWith('/')) options.base += '/';
  return options;
}

class UsageError extends Error {}

/**
 * Absolute destination, refused unless it is inside the repository. This
 * script deletes the directory before copying into it; a path outside the
 * checkout (or the checkout root itself) turns a typo into data loss.
 */
function resolveOutDir(out) {
  const abs = path.resolve(REPO_ROOT, out);
  const relative = path.relative(REPO_ROOT, abs);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new UsageError(
      `--out must be a path inside the repository; got ${abs}`,
    );
  }
  return abs;
}

function runBuild({ base, dryRun }) {
  const env = { ...process.env, ...DEMO_FIREBASE_ENV, VITE_DEMO_MODE: '1' };
  // See the header: the demo is the committed synthetic snapshot, never a
  // deploy-time export of a real project.
  delete env.GENERATED_DIR;

  const args = ['run', 'build', '-w', 'apps/web', '--', '--base', base];
  if (dryRun) {
    console.log(`[dry-run] npm ${args.join(' ')}  (VITE_DEMO_MODE=1)`);
    return;
  }
  const result = spawnSync('npm', args, {
    cwd: REPO_ROOT,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`vite build failed (exit ${result.status}).`);
    process.exit(4);
  }
}

/**
 * GitHub Pages runs Jekyll over what it serves from /docs, and Jekyll drops
 * files and directories whose name starts with `_`. Vite does not emit any
 * today, but a plugin or a future default could, so the check is done against
 * the real output rather than assumed away. `.nojekyll` at the SITE root is
 * the fix, and this repo's site root is docs/ — a file another agent's docs
 * site shares. It is created only if actually needed, and never modified if
 * it already exists.
 */
function ensureJekyllSafety(outDir, dryRun) {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_')) {
        offenders.push(path.relative(outDir, path.join(dir, entry.name)));
      }
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  if (fs.existsSync(outDir)) walk(outDir);

  const siteRoot = path.dirname(outDir);
  const marker = path.join(siteRoot, '.nojekyll');
  if (offenders.length === 0) {
    console.log('No underscore-prefixed output files; .nojekyll not needed.');
    return { offenders, created: false };
  }
  console.log(
    `Underscore-prefixed output (${offenders.join(', ')}) — Jekyll would drop it.`,
  );
  if (fs.existsSync(marker)) {
    console.log(`${path.relative(REPO_ROOT, marker)} already present.`);
    return { offenders, created: false };
  }
  if (dryRun) {
    console.log(`[dry-run] create ${path.relative(REPO_ROOT, marker)}`);
    return { offenders, created: false };
  }
  fs.writeFileSync(marker, '');
  console.log(`Created ${path.relative(REPO_ROOT, marker)}.`);
  return { offenders, created: true };
}

function directorySize(dir) {
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = directorySize(full);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      bytes += fs.statSync(full).size;
      files += 1;
    }
  }
  return { bytes, files };
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
    options.outDir = resolveOutDir(options.out);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  console.log(`Demo build → ${path.relative(REPO_ROOT, options.outDir)}`);
  console.log(`  base: ${options.base}`);

  runBuild(options);

  if (options.dryRun) {
    console.log(
      `[dry-run] rm -rf ${path.relative(REPO_ROOT, options.outDir)} && ` +
        `cp -R apps/web/dist/. ${path.relative(REPO_ROOT, options.outDir)}`,
    );
    return 0;
  }

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`Expected build output at ${DIST_DIR}; it is not there.`);
    return 4;
  }

  // Delete first: hashed asset names change every build, so a plain copy
  // would accumulate every past build's chunks forever.
  fs.rmSync(options.outDir, { recursive: true, force: true });
  fs.mkdirSync(options.outDir, { recursive: true });
  fs.cpSync(DIST_DIR, options.outDir, { recursive: true });

  ensureJekyllSafety(options.outDir, options.dryRun);

  const { bytes, files } = directorySize(options.outDir);
  console.log(
    `Synced ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB → ` +
      `${path.relative(REPO_ROOT, options.outDir)}`,
  );
  console.log('Nothing was committed; review and commit docs/demo/ yourself.');
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  resolveOutDir,
  DEFAULT_BASE,
  DEFAULT_OUT,
  DEMO_FIREBASE_ENV,
  UsageError,
};
