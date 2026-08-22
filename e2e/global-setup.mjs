// Playwright global setup (issue #38): seeds the emulator project once for
// the whole suite, the same two scripts an operator runs against a real
// project (scripts/README.md):
//
//   1. init-event.cjs   — bootstraps config/{event,features,theme,bootstrap}
//      from e2e/fixtures/answers.json, admin e2e-admin@example.test
//      (spec §5.1). This is also where sessionBookmarks and
//      autoApproveTicketHolders get turned on for the ticket-claim journey.
//   2. seed-demo-event.cjs — layers the synthetic demo fixture on top
//      (§5.4): sessions, speakers, sponsors. It never touches config/event
//      once init has already created it (idempotency rule, scripts/lib/
//      idempotency.cjs) — only cmsPages/cmsContent (still `seeded: true`,
//      so refreshed with the demo's overlay copy) and the collections init
//      does not seed at all (cmsSchedule, cmsOrganizations, speakers).
//
// Runs inside `firebase emulators:exec` (scripts/dev/run-e2e.sh), so
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST /
// FIREBASE_STORAGE_EMULATOR_HOST are already exported — the two scripts
// need nothing else to connect.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminDb } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const answersFile = path.join(here, 'fixtures', 'answers.json');

function run(script, args) {
  execFileSync('node', [path.join(repoRoot, 'scripts', script), ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
}

export default async function globalSetup() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set — the e2e suite must run inside ' +
      '`firebase emulators:exec` (npm run test:e2e / scripts/dev/run-e2e.sh), never directly.',
    );
  }

  console.log('[e2e global-setup] init-event.cjs');
  run('init-event.cjs', ['--answers', answersFile, '--admin', 'e2e-admin@example.test', '--skip-branding']);

  console.log('[e2e global-setup] seed-demo-event.cjs');
  run('seed-demo-event.cjs', []);

  // Sanity-check the seed actually landed before any spec starts — a failed
  // or partial seed should fail loudly here, not as a mysterious 404 three
  // specs later.
  const eventSnap = await adminDb().collection('config').doc('event').get();
  if (!eventSnap.exists) {
    throw new Error('[e2e global-setup] config/event is missing after seeding — see the seed output above.');
  }
  const bootstrapSnap = await adminDb().collection('config').doc('bootstrap').get();
  const adminEmails = bootstrapSnap.data()?.adminEmails || [];
  if (!adminEmails.includes('e2e-admin@example.test')) {
    throw new Error('[e2e global-setup] e2e-admin@example.test was not seeded as an admin.');
  }
  console.log('[e2e global-setup] seed complete.');
}
