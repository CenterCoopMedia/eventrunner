#!/usr/bin/env node
'use strict';

/**
 * Build-time content snapshot generator (spec §2.4 path 1, §8.6).
 *
 * Writes the five `apps/web/src/generated/*` files the web app renders on
 * first paint, from one of two sources:
 *
 *   --demo            the in-repo synthetic demo fixture
 *                     (scripts/lib/demo-event.cjs). No credentials, no
 *                     network, no emulator. This is what regenerates the
 *                     COMMITTED snapshot, and what the §8.6 hygiene gate
 *                     runs on every PR including forks.
 *   (default)         a real deployment, read through the Admin SDK:
 *                     config/* plus the PUBLISHED cms collections.
 *
 * Deploy-time generation must never write into the working tree (§8.6): a
 * client's real content sitting in a public repo's tree, one `git add -A`
 * from being committed, is the failure this guards. So `--out <dir>` (or
 * GENERATED_DIR) is required whenever the source is a real project, and
 * writing to the committed directory from a real project is refused.
 *
 * Usage:
 *   node scripts/generate-content.cjs --demo
 *   node scripts/generate-content.cjs --demo --check      # diff, write nothing
 *   node scripts/generate-content.cjs --out "$RUNNER_TEMP/generated"
 *
 * Against the emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   EVENT_FIREBASE_PROJECT_ID=demo-run-of-show \
 *   node scripts/generate-content.cjs --out /tmp/generated
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { emitAll } = require('./lib/emit.cjs');
const { demoSnapshot } = require('./lib/demo-event.cjs');

const ROOT = path.resolve(__dirname, '..');
const COMMITTED_DIR = path.join(ROOT, 'apps', 'web', 'src', 'generated');

const FLAGS = ['demo', 'out', 'check', 'help'];

function usage() {
  return [
    'Usage: node scripts/generate-content.cjs [--demo] [--out <dir>] [--check]',
    '',
    '  --demo         generate from the in-repo demo fixture (no credentials)',
    '  --out <dir>    write here instead of apps/web/src/generated',
    '                 (required when reading a real project — §8.6)',
    '  --check        compare against the target directory and exit non-zero',
    '                 on any difference; writes nothing',
  ].join('\n');
}

/**
 * Read a live deployment into the emitter snapshot shape. Published
 * collections only — drafts are not what the public bundle ships.
 *
 * @param {{ db: object }} deps
 * @returns {Promise<object>}
 */
async function readDeployment({ db }) {
  const configIds = ['event', 'features', 'theme'];
  const configSnaps = await db.getAll(...configIds.map((id) => db.collection('config').doc(id)));
  const config = {};
  configIds.forEach((id, i) => {
    config[id] = configSnaps[i].exists ? configSnaps[i].data() : null;
  });
  for (const id of configIds) {
    if (!config[id]) throw new Error(`config/${id} is missing — run scripts/init-event.cjs first`);
  }

  const readCollection = async (name) => {
    const snap = await db.collection(name).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  };
  const [pages, content, sessions, organizations] = await Promise.all([
    readCollection('cmsPages'),
    readCollection('cmsContent'),
    readCollection('cmsSchedule'),
    readCollection('cmsOrganizations'),
  ]);
  const speakers = await readCollection('speakers').catch(() => []);

  return {
    event: config.event,
    features: config.features,
    theme: config.theme,
    pages,
    content,
    sessions,
    organizations,
    speakers,
  };
}

async function main(argv) {
  const args = parseArgv(argv, { withValue: ['out'] });
  const unknown = unknownFlags(args, FLAGS);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (unknown.length > 0) {
    console.error(`Unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}\n\n${usage()}`);
    return 2;
  }

  const outDir = path.resolve(
    ROOT,
    (typeof args.out === 'string' && args.out) || process.env.GENERATED_DIR || COMMITTED_DIR,
  );

  let snapshot;
  if (args.demo) {
    snapshot = demoSnapshot();
  } else {
    if (outDir === COMMITTED_DIR) {
      console.error(
        'Refusing to write a real deployment into apps/web/src/generated (spec §8.6).\n' +
        'Pass --out <dir> (or set GENERATED_DIR) so deploy-time generation stays out of the tree.',
      );
      return 2;
    }
    const { initFirebase } = require('./lib/firebase-init.cjs');
    const { db, projectId, mode } = initFirebase({ env: process.env });
    console.log(`generate-content: reading ${projectId} (${mode})`);
    snapshot = await readDeployment({ db });
  }

  const files = emitAll(snapshot);

  if (args.check) {
    const differences = [];
    for (const [name, contents] of Object.entries(files)) {
      const target = path.join(outDir, name);
      const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
      if (existing !== contents) differences.push(name);
    }
    if (differences.length > 0) {
      console.error(
        `generate-content --check: ${differences.length} file(s) differ from ${path.relative(ROOT, outDir)}:\n` +
        differences.map((d) => `  - ${d}`).join('\n') +
        '\n\nRegenerate with: node scripts/generate-content.cjs --demo',
      );
      return 1;
    }
    console.log(`generate-content --check: ${Object.keys(files).length} file(s) match the committed snapshot`);
    return 0;
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, name), contents);
  }
  console.log(`generate-content: wrote ${Object.keys(files).length} file(s) to ${path.relative(ROOT, outDir) || outDir}`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`generate-content: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, readDeployment, internals: { COMMITTED_DIR } };
