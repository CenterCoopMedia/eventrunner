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

/**
 * True when `target` is the repository root or anything under it.
 *
 * Path-based rather than string-prefix based: `path.relative` handles
 * `..`, and a sibling directory whose name merely starts with the repo's
 * (`/work/run-of-show-out`) must NOT be treated as inside it.
 *
 * @param {string} target absolute path
 * @returns {boolean}
 */
function isInsideRepo(target) {
  const rel = path.relative(ROOT, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

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
    // `id` last: a stored field named `id` (a page doc carries one — §5.2)
    // must not win over the document's actual id, or the emitted map would
    // be keyed wrong and two docs could collapse onto one key.
    return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  };
  // Every PUBLISHABLE_COLLECTIONS live doc (functions/src/cms/blockTypes.cjs)
  // carries `visible` — unpublish (spec §8.4 point 4) sets it false WITHOUT
  // deleting the live doc, so reading the live collection unfiltered would
  // still ship an explicitly-unpublished doc into the public JS bundle. The
  // getSiteContent HTTP endpoint filters the same way
  // (functions/src/cms/content.cjs); this is that same filter, applied here
  // so the build-time snapshot and the runtime read agree.
  const readVisibleCollection = async (name) => {
    const snap = await db.collection(name).where('visible', '==', true).get();
    return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  };
  // Speakers come from `speakers_public`, NOT from the canonical
  // `speakers` collection (spec §4.3). The canonical record carries
  // `email`, `uid`, `inviteToken`, and the pipeline `status`; emitting it
  // would compile a client's speaker email addresses and live invite
  // tokens into a publicly served JavaScript bundle. The projection is the
  // published, public-safe view by definition, and it exists only for
  // speakers whose status is `approved` — so it also replaces the
  // `visible == true` filter the publishable collections need. No
  // per-collection catch: a collection that does not exist yet already
  // returns an empty snapshot, so the only thing a catch here could
  // swallow is a transient read failure — which would silently ship a
  // build with no speakers rather than failing the generation.
  const [pages, content, sessions, organizations, speakerProjections] = await Promise.all([
    readVisibleCollection('cmsPages'),
    readVisibleCollection('cmsContent'),
    readVisibleCollection('cmsSchedule'),
    readVisibleCollection('cmsOrganizations'),
    readCollection('speakers_public'),
  ]);
  // `speakerId` on the projection is the document id under another name;
  // the emitted snapshot addresses speakers by `id` like every other
  // collection, so carrying both would be two spellings of one value.
  const speakers = speakerProjections.map(({ speakerId: _speakerId, ...rest }) => rest);

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
  } else if (isInsideRepo(outDir)) {
    // ANY path inside the checkout, not just the committed directory:
    // `--out apps/web/client-generated` would drop a client's real event
    // config into the working tree of a public repo, which is the thing
    // §8.6 is about — one `git add -A` from being committed. The
    // committed-directory check alone was a spelling test, not a guard.
    console.error(
      `Refusing to write a real deployment inside the repository (${path.relative(ROOT, outDir) || '.'}) — spec §8.6.\n` +
      'Point --out (or GENERATED_DIR) at a directory outside the checkout, e.g. "$RUNNER_TEMP/generated".',
    );
    return 2;
  } else {
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
    // A byte-for-byte match on the expected file set is not the whole
    // hygiene gate: it says nothing about an EXTRA file sitting in the
    // directory (a leaked real-deployment artifact, a stray debug file)
    // that the expected-name loop above never looks at. List the
    // directory and flag anything present that emitAll() did not produce.
    const expected = new Set(Object.keys(files));
    const unexpected = fs.existsSync(outDir)
      ? fs.readdirSync(outDir).filter((entry) => !expected.has(entry))
      : [];
    if (differences.length > 0 || unexpected.length > 0) {
      const lines = [];
      if (differences.length > 0) {
        lines.push(
          `${differences.length} file(s) differ from ${path.relative(ROOT, outDir)}:`,
          ...differences.map((d) => `  - ${d}`),
        );
      }
      if (unexpected.length > 0) {
        lines.push(
          `${unexpected.length} unexpected file(s) present in ${path.relative(ROOT, outDir)}:`,
          ...unexpected.map((d) => `  - ${d}`),
        );
      }
      console.error(
        `generate-content --check:\n${lines.join('\n')}\n\n` +
        'Regenerate with: node scripts/generate-content.cjs --demo\n' +
        '(an unexpected file must be removed by hand — regenerating does not delete it).',
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
