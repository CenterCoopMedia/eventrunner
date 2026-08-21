#!/usr/bin/env node
'use strict';

/**
 * Seed the public demo instance (spec §1.5, §5.4; milestone issue #35).
 *
 * The demo is a fictional three-day event: made-up organizer, made-up
 * venue, placeholder speakers and sponsors, sessions across all three days.
 * It exists so someone can look at a working deployment without a client's
 * data being the thing they are looking at — which is also why nothing here
 * is real (§5.4: no real names, cities, logos, or copy, in seeds, fixtures,
 * tests, or the demo instance).
 *
 * The fixture lives in `scripts/lib/demo-event.cjs` and is shared with
 * `generate-content.cjs --demo`, so the demo instance and the committed
 * `apps/web/src/generated/*` snapshot are the same event by construction.
 *
 * Idempotent on the same terms as init (§5.1): documents still carrying
 * `seeded: true` are refreshed, anything edited on the demo instance is
 * left alone.
 *
 * Usage (emulator):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   EVENT_FIREBASE_PROJECT_ID=demo-run-of-show \
 *   node scripts/seed-demo-event.cjs
 *
 * Usage (the real demo project):
 *   EVENT_FIREBASE_PROJECT_ID=<demo project> node scripts/seed-demo-event.cjs
 *
 * The project id must contain "demo": the one thing this script must never
 * do is overwrite a client deployment with placeholder speakers. Pass
 * --i-know-this-is-not-a-demo-project to override deliberately.
 */

const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { demoEvent } = require('./lib/demo-event.cjs');
const { writeConfigDocs, seedCollection } = require('./lib/write.cjs');

const FLAGS = ['dry-run', 'force', 'i-know-this-is-not-a-demo-project', 'help'];

/**
 * True when the project id is a demo project.
 *
 * A substring test is not good enough for a guard whose whole job is
 * refusing to publish placeholder speakers onto a live site:
 * `democratic-media-prod` contains "demo". So the match is either an
 * exact `DEMO_PROJECT_ID` (the deployment says which project it is) or a
 * DELIMITED `demo` component of the id — `demo-run-of-show`,
 * `run_of_show_demo`, or the bare id `demo` — never a fragment of a
 * longer word.
 *
 * @param {string} projectId
 * @param {string|undefined} configuredDemoId `DEMO_PROJECT_ID`
 * @returns {boolean}
 */
function isDemoProject(projectId, configuredDemoId) {
  const id = String(projectId || '').trim().toLowerCase();
  const configured = String(configuredDemoId || '').trim().toLowerCase();
  if (configured) return id === configured;
  return id.split(/[-_.]/).includes('demo');
}

function usage() {
  return [
    'Usage: node scripts/seed-demo-event.cjs [--dry-run] [--force]',
    '',
    '  --dry-run   report every write without performing it',
    '  --force     refresh config documents that already exist',
    '  --i-know-this-is-not-a-demo-project',
    '              allow a project id that does not contain "demo"',
  ].join('\n');
}

async function seedDemo({ db, store, args, now = Date.now }) {
  const dryRun = Boolean(args['dry-run']);
  const force = Boolean(args.force);
  const demo = demoEvent();

  console.log(`\nseed-demo-event: ${dryRun ? 'DRY RUN — ' : ''}seeding the synthetic demo event\n`);

  // writeConfigDocs answers { results, effective } — the per-doc decisions
  // AND what the project now holds. Destructuring matters: iterating the
  // wrapper object threw "configResults is not iterable" and took the whole
  // seed run down before it reached a single collection.
  const { results: configResults } = await writeConfigDocs({ db, docs: demo.config, force, dryRun, now });
  for (const r of configResults) console.log(`  config/${r.docId.padEnd(9)} ${r.action} (${r.reason})`);

  const collections = [
    ['cmsPages', demo.pages],
    ['cmsContent', demo.content],
    ['cmsSchedule', demo.sessions],
    ['cmsOrganizations', demo.organizations],
  ];
  for (const [collection, docs] of collections) {
    const result = await seedCollection({ db, store, collection, docs, dryRun, now, force });
    console.log(
      `  ${collection.padEnd(17)} ${result.created.length} created, ${result.refreshed.length} refreshed, ` +
      `${result.skipped.length} left alone`,
    );
  }

  // Speakers are a plain collection, not part of the two-revision publish
  // model (§4.3: the speaker profile is its own single source of truth),
  // so they are written directly rather than through draft + publish.
  //
  // The matching `speaker_slugs/{slug}` reservation is written too. That
  // collection is the lock createSpeaker takes to keep slugs unique
  // (functions/src/speakers/profile.cjs); a seeded speaker with no
  // reservation would leave its slug apparently free, so the demo would
  // happily accept a second speaker claiming the same public URL.
  let speakerWrites = 0;
  for (const speaker of demo.speakers) {
    const { id, ...fields } = speaker;
    const ref = db.collection('speakers').doc(id);
    const snap = await ref.get();
    if (snap.exists && snap.data()?.seeded !== true) continue;
    speakerWrites += 1;
    if (!dryRun) {
      await ref.set({ ...fields, updatedAt: new Date(now()) });
      if (fields.slug) {
        await db.collection('speaker_slugs').doc(fields.slug).set({
          speakerId: id,
          updatedAt: new Date(now()),
        });
      }
    }
  }
  console.log(`  speakers          ${speakerWrites} written`);

  console.log(
    '\nseed-demo-event: done. Regenerate the committed snapshot with:\n' +
    '  node scripts/generate-content.cjs --demo',
  );
  return 0;
}

async function main(argv) {
  const args = parseArgv(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const unknown = unknownFlags(args, FLAGS);
  if (unknown.length > 0) {
    console.error(`Unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}\n\n${usage()}`);
    return 2;
  }

  const { initFirebase } = require('./lib/firebase-init.cjs');
  let handles;
  try {
    handles = initFirebase({ env: process.env });
  } catch (err) {
    console.error(`Cannot connect: ${err.message}`);
    return 2;
  }
  const { db, projectId, mode } = handles;
  if (!isDemoProject(projectId, process.env.DEMO_PROJECT_ID) && !args['i-know-this-is-not-a-demo-project']) {
    console.error(
      `Refusing to seed demo content into "${projectId}": the project id does not contain "demo".\n` +
      'This script writes placeholder speakers and sponsors; running it against a client deployment ' +
      'would publish them on a live site.\n' +
      'Override with --i-know-this-is-not-a-demo-project if that is genuinely what you want.',
    );
    return 2;
  }
  console.log(`seed-demo-event: project ${projectId} (${mode} credentials)`);
  const store = require('../functions/src/cms/store.cjs');
  return seedDemo({ db, store, args });
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`seed-demo-event: ${err.stack || err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, seedDemo, isDemoProject, internals: { usage, FLAGS } };
