#!/usr/bin/env node
'use strict';

/**
 * Bootstrap a fresh deployment (spec §5.1, issue #18).
 *
 * Runs after the operator has created the Firebase project and the deploy
 * workflow has pushed rules, indexes, and functions (§5.1 steps 1–3). In
 * order, it:
 *
 *   a. validates Tier A env and refuses a project that already has
 *      `config/event` unless `--force` is passed;
 *   b. writes `config/event`, `config/features`, `config/theme`,
 *      `config/badges`, `config/providers` from `--answers <file>` or
 *      interactive prompts;
 *   c. writes `config/bootstrap.adminEmails` from `--admin` flags — the
 *      single source of admin identity for the whole platform
 *      (functions/src/core/auth.cjs requireAdmin, firestore.rules isAdmin,
 *      and the web AuthContext probe all read it; nothing reads an
 *      ADMIN_EMAILS env var any more);
 *   d. seeds `cmsPages` with the ten default pages (§5.3);
 *   e. seeds `cmsContent` with placeholder blocks for every `defaultBlocks`
 *      entry, and the two legal pages from the provider-aware templates
 *      (§5.4, §5.5);
 *   g. uploads the neutral placeholder branding assets (§5.4);
 *   h. prints the manual checklist (§5.6) and the launch-readiness summary,
 *      then EXITS 0.
 *
 * Init never fails on an unmet readiness item — §5.1.1: `legal.reviewRequired`
 * is true on every fresh deployment because step (e) sets it, and the only
 * way to clear it is an admin UI that needs the hosting deploy a non-zero
 * exit would have blocked. Init is the gate on nothing; `--check` is the
 * gate on going live.
 *
 * Idempotency (§5.1): re-running never clobbers a client. A seeded doc is
 * refreshed only while it still carries `seeded: true`; the moment an
 * editor touches it the flag clears and init leaves it alone — even under
 * `--force`, which only relaxes the whole-run refusal.
 *
 * Usage:
 *   node scripts/init-event.cjs --answers client-answers.json --admin ops@example.org
 *   node scripts/init-event.cjs --check
 *   node scripts/init-event.cjs --attest-auth
 *
 * Credentials (never interactive — these run in CI and over SSH):
 *   emulator:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *              EVENT_FIREBASE_PROJECT_ID=demo-run-of-show node scripts/init-event.cjs ...
 *   CI:        GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 *   laptop:    application-default credentials already on the machine
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { PROMPTS, parseAnswersFile, buildConfigDocs } = require('./lib/answers.cjs');
const { defaultPages, buildSeedContent, buildLegalContentDocs } = require('./lib/seed.cjs');
const { validatePageDoc } = require('../functions/src/cms/pages.cjs');
const { getTierA } = require('../functions/src/core/config.cjs');
const { evaluateReadiness, allReady, formatReadinessTable, DEFAULT_SEEDED_THRESHOLD } =
  require('./lib/readiness.cjs');
const { manualChecklist, formatChecklist } = require('./lib/checklist.cjs');
const { validateDeployEnv } = require('shared/config');
const { uploadPlaceholderBranding } = require('./lib/branding.cjs');
const { writeConfigDocs, seedCollection, countSeeded, readConfig } = require('./lib/write.cjs');

const FLAGS = [
  'answers', 'admin', 'force', 'check', 'attest-auth', 'dry-run',
  'skip-branding', 'seeded-threshold', 'help',
];

function usage() {
  return [
    'Usage: node scripts/init-event.cjs [options]',
    '',
    '  --answers <file>        client answers JSON (otherwise prompts interactively)',
    '  --admin <email>         first admin address; repeatable',
    '  --force                 re-run against a project that already has config/event',
    '                          (client-edited documents are still never overwritten)',
    '  --check                 read-only launch-readiness check; exits non-zero if unmet',
    '  --attest-auth           record that the manual Firebase Auth steps are done',
    '  --dry-run               report every write without performing it',
    '  --skip-branding         do not upload the placeholder branding assets',
    '  --seeded-threshold <n>  how many seeded blocks --check tolerates (default 0)',
  ].join('\n');
}

/**
 * Tier A validation before the first write (§5.1 step a).
 *
 * `getTierA()` reads the environment; it does not judge it. Without this,
 * an unset `EVENT_EMAIL_PROVIDER` quietly becomes `console` in
 * `config/providers`, init reports success, and the deployment looks
 * seeded right up until the functions runtime refuses to build an email
 * provider in production — a failure landing hours later, far from its
 * cause. The shared validator is the same one the build runs, so init
 * cannot develop its own opinion of what a valid environment is.
 *
 * Two severities, one validator:
 *   - server-side `EVENT_*` keys are what init consumes and mirrors into
 *     Firestore, so a missing one is fatal;
 *   - `VITE_*` keys gate the frontend build, not the seed, so a missing
 *     one is reported and the run continues (the build will fail loudly
 *     on its own).
 *
 * Under `FIRESTORE_EMULATOR_HOST` everything is a warning: the emulator is
 * explicitly not a deployment, and demanding a hosting site and storage
 * bucket to seed a throwaway project would only teach operators to fake
 * the values.
 *
 * @param {Record<string,string|undefined>} env
 * @returns {{ ok: boolean, fatal: string[], warnings: string[] }}
 */
function checkDeployEnv(env) {
  const verdict = validateDeployEnv(env);
  const emulator = Boolean((env.FIRESTORE_EMULATOR_HOST || '').trim());
  const fatal = [];
  const warnings = [];
  for (const key of verdict.missing) {
    (key.startsWith('VITE_') || emulator ? warnings : fatal).push(`${key}: not set`);
  }
  for (const problem of verdict.errors) {
    (emulator ? warnings : fatal).push(problem);
  }
  return { ok: fatal.length === 0, fatal, warnings };
}

/** Walk PROMPTS with node:readline. Only reached without --answers. */
async function promptForAnswers({ input = process.stdin, output = process.stdout } = {}) {
  const readline = require('node:readline/promises');
  const rl = readline.createInterface({ input, output });
  const answers = {};
  const { internals } = require('./lib/answers.cjs');
  try {
    for (const prompt of PROMPTS) {
      for (;;) {
        const suffix = prompt.default ? ` [${prompt.default}]` : '';
        const raw = (await rl.question(`${prompt.question}${suffix}: `)).trim();
        const value = raw === '' ? (prompt.default ?? '') : raw;
        if (value === '' && prompt.required) {
          output.write('  This one is required.\n');
          continue;
        }
        if (value === '') break;
        const parsed = prompt.parse ? prompt.parse(value) : value;
        if (parsed instanceof Error) {
          output.write(`  ${parsed.message}\n`);
          continue;
        }
        internals.setPath(answers, prompt.path, parsed);
        break;
      }
    }
  } finally {
    rl.close();
  }
  return answers;
}

/** Print the readiness table; return whether everything passed. */
function reportReadiness(snapshot, { gate }) {
  const rows = evaluateReadiness(snapshot);
  console.log('\nLaunch readiness (spec §5.1.1)\n');
  console.log(formatReadinessTable(rows));
  const ready = allReady(rows);
  if (!ready && !gate) {
    console.log(
      '\nThese are warnings, not failures: init cannot clear them (§5.1.1). ' +
      'Run `node scripts/init-event.cjs --check` before launch.',
    );
  }
  return ready;
}

async function runCheck({ db, seededThreshold }) {
  const config = await readConfig({ db });
  if (!config.event) {
    console.error('config/event is missing — this project has not been initialized. Run init-event.cjs first.');
    return 2;
  }
  const seededContentCount = await countSeeded({ db });
  const ready = reportReadiness({ ...config, seededContentCount, seededThreshold }, { gate: true });
  if (!ready) {
    console.error('\n--check: not ready to launch. Address the UNMET rows above.');
    return 1;
  }
  console.log('\n--check: ready to launch.');
  return 0;
}

async function runAttestAuth({ db, store, dryRun, env = process.env, now = Date.now }) {
  const ref = db.collection('config').doc('event');
  const snap = await ref.get();
  if (!snap.exists) {
    console.error('config/event is missing — run init-event.cjs before attesting.');
    return 2;
  }
  const attestation = {
    googleProviderEnabled: true,
    authorizedDomainsConfigured: true,
    attestedAt: new Date(now()).toISOString(),
    attestedBy: env.USER || env.LOGNAME || 'operator',
  };
  console.log('Recording the operator attestation for the §5.6 Firebase Auth steps:');
  console.log(`  Google sign-in provider enabled:     yes`);
  console.log(`  Custom + Hosting domains authorized: yes`);
  console.log(`  Attested by:                         ${attestation.attestedBy}`);
  if (dryRun) {
    console.log('--dry-run: nothing written.');
    return 0;
  }
  await ref.set({ auth: attestation }, { merge: true });
  console.log('config/event.auth updated.');

  // Enabling Google sign-in changes what the privacy policy and terms are
  // TRUE about: the seeded copy describes the sign-in methods this
  // deployment offers (§5.5), and it was composed when the answer was
  // "emailed codes only". Leaving it would publish a privacy policy that
  // omits a sign-in method the site now has. Refreshed through the normal
  // seed path, so anything a client has already edited keeps their words.
  if (!store) return 0;
  const config = await readConfig({ db });
  const legalDocs = buildLegalContentDocs({
    docs: {
      event: { ...config.event, auth: attestation },
      providers: config.providers,
      features: config.features,
    },
    seededAt: new Date(now()).toISOString(),
  });
  const result = await seedCollection({ db, store, collection: 'cmsContent', docs: legalDocs, now });
  console.log(
    `Legal templates: ${result.refreshed.length + result.created.length} refreshed, ` +
    `${result.skipped.length} left alone (client-edited).`,
  );
  return 0;
}

async function runInit({ db, store, bucket, args, tierA, env = process.env, now = Date.now }) {
  const dryRun = Boolean(args['dry-run']);
  const force = Boolean(args.force);

  // (a) Tier A first: a deployment seeded from a half-configured
  // environment is worse than one that refused to seed.
  const envCheck = checkDeployEnv(env);
  for (const warning of envCheck.warnings) console.warn(`warning: ${warning}`);
  if (!envCheck.ok) {
    console.error(
      '\nTier A environment is incomplete — nothing was written:\n  ' +
      `${envCheck.fatal.join('\n  ')}\n\nSee .env.example for the full set (spec §2.1).`,
    );
    return 2;
  }

  // (a, continued) Refuse an already-initialized project unless --force. The common
  // accident is running init twice, or against the wrong project; stopping
  // before the first write is better than merging around it.
  const eventSnap = await db.collection('config').doc('event').get();
  if (eventSnap.exists && !force) {
    console.error(
      'config/event already exists in this project.\n' +
      'Re-run with --force to refresh the seed (client-edited documents are still never overwritten), ' +
      'or run --check for launch readiness.',
    );
    return 2;
  }

  // (b) Collect answers.
  let answers;
  if (typeof args.answers === 'string' && args.answers) {
    const file = path.resolve(process.cwd(), args.answers);
    if (!fs.existsSync(file)) {
      console.error(`Answers file not found: ${file}`);
      return 2;
    }
    const parsed = parseAnswersFile(fs.readFileSync(file, 'utf8'));
    if (!parsed.ok) {
      console.error(`Answers file rejected:\n  ${parsed.errors.join('\n  ')}`);
      return 2;
    }
    answers = parsed.answers;
  } else if (process.stdin.isTTY) {
    answers = await promptForAnswers();
  } else {
    console.error('No --answers file and no TTY for prompts. Pass --answers <file>.');
    return 2;
  }

  // --admin wins over the answers file: the operator running the command is
  // the one who knows which address can actually sign in today.
  const adminFlags = Array.isArray(args.admin) ? args.admin : (args.admin ? [args.admin] : []);
  if (adminFlags.length > 0) answers.adminEmails = adminFlags;

  const built = buildConfigDocs({ answers, tierA, now });
  for (const warning of built.warnings) console.warn(`warning: ${warning}`);
  if (!built.ok) {
    console.error(`\nConfiguration rejected — nothing was written:\n  ${built.errors.join('\n  ')}`);
    return 2;
  }
  const { docs } = built;

  // (d) Pages, validated with the REAL validator the admin endpoint uses,
  // so a seed can never create a page cmsSavePage would refuse.
  const seededAt = new Date(now()).toISOString();
  const pages = defaultPages().map((page) => ({ ...page, seeded: true }));
  const pageErrors = [];
  for (const page of pages) {
    // `seeded`/`seededAt` are seed bookkeeping, not part of the page
    // contract, so the CONTRACT is what gets validated.
    const { seeded, ...contract } = page;
    const verdict = validatePageDoc(contract);
    if (!verdict.ok) pageErrors.push(`${page.id}: ${verdict.errors.join('; ')}`);
  }
  if (pageErrors.length > 0) {
    console.error(`\nSeeded pages failed validation — nothing was written:\n  ${pageErrors.join('\n  ')}`);
    return 2;
  }
  const pageDocs = pages.map((page) => ({ ...page, seededAt }));

  console.log(`\ninit-event: ${dryRun ? 'DRY RUN — ' : ''}seeding ${tierA.projectId}\n`);

  const { results: configResults, effective } = await writeConfigDocs({ db, docs, force, dryRun, now });
  for (const r of configResults) console.log(`  config/${r.docId.padEnd(9)} ${r.action} (${r.reason})`);

  // Content is derived from the EFFECTIVE config, not from what was
  // proposed: on a --force re-run the merge rules keep the stored auth
  // attestation and legal review flag, and the §5.5 legal templates read
  // exactly those. Building from `docs` would regenerate the privacy page
  // as if Google sign-in had never been enabled.
  const content = buildSeedContent({ pages, docs: effective, tierA, seededAt });

  const pageResult = await seedCollection({ db, store, collection: 'cmsPages', docs: pageDocs, dryRun, now, force });
  console.log(
    `  cmsPages          ${pageResult.created.length} created, ${pageResult.refreshed.length} refreshed, ` +
    `${pageResult.skipped.length} left alone`,
  );
  for (const s of pageResult.skipped) console.log(`    - ${s.id}: ${s.reason}`);

  const contentResult = await seedCollection({ db, store, collection: 'cmsContent', docs: content, dryRun, now, force });
  console.log(
    `  cmsContent        ${contentResult.created.length} created, ${contentResult.refreshed.length} refreshed, ` +
    `${contentResult.skipped.length} left alone`,
  );

  // (g) Branding placeholders. Fail-soft (§5.1.1): the assets also ship in
  // the web bundle, so a skipped upload degrades, it does not break.
  if (args['skip-branding']) {
    console.log('  branding/         skipped (--skip-branding)');
  } else {
    const branding = await uploadPlaceholderBranding({ bucket, dryRun });
    console.log(`  branding/         ${branding.uploaded.length} uploaded, ${branding.skipped.length} skipped`);
    for (const s of branding.skipped) {
      // A slot holding a client's own asset is the system working, not a
      // problem; only a real upload failure is worth a warning.
      if (s.kind === 'error') console.warn(`    warning: ${s.path}: ${s.reason}`);
      else console.log(`    - ${s.path}: ${s.reason}`);
    }
  }

  // (h) Manual checklist, then readiness — warnings only, exit 0.
  console.log('\nManual steps a deploy cannot automate (spec §5.6)\n');
  console.log(formatChecklist(manualChecklist({
    providers: effective.providers,
    adminEmails: effective.bootstrap.adminEmails,
    publicUrl: tierA.publicUrl,
    hostingSite: env.EVENT_HOSTING_SITE || null,
    senderEmail: effective.event.sender.email,
  })));

  const seededContentCount = dryRun ? content.length : await countSeeded({ db });
  reportReadiness(
    {
      event: effective.event,
      providers: effective.providers,
      theme: effective.theme,
      bootstrap: effective.bootstrap,
      seededContentCount,
      seededThreshold: DEFAULT_SEEDED_THRESHOLD,
    },
    { gate: false },
  );
  console.log('\ninit-event: done.');
  return 0;
}

async function main(argv) {
  const args = parseArgv(argv, { withValue: ['answers', 'seeded-threshold'], repeatable: ['admin'] });
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const unknown = unknownFlags(args, FLAGS);
  if (unknown.length > 0) {
    console.error(`Unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}\n\n${usage()}`);
    return 2;
  }

  const tierA = getTierA(process.env);
  const { initFirebase } = require('./lib/firebase-init.cjs');
  let handles;
  try {
    handles = initFirebase({ env: process.env });
  } catch (err) {
    console.error(`Cannot connect: ${err.message}`);
    return 2;
  }
  const { db, projectId, mode, bucket } = handles;
  console.log(`init-event: project ${projectId} (${mode} credentials)`);

  if (args.check) {
    const threshold = args['seeded-threshold'] !== undefined
      ? Number(args['seeded-threshold'])
      : DEFAULT_SEEDED_THRESHOLD;
    return runCheck({ db, seededThreshold: Number.isFinite(threshold) ? threshold : DEFAULT_SEEDED_THRESHOLD });
  }
  const store = require('../functions/src/cms/store.cjs');
  if (args['attest-auth']) {
    return runAttestAuth({ db, store, dryRun: Boolean(args['dry-run']) });
  }
  return runInit({ db, store, bucket, args, tierA });
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`init-event: ${err.stack || err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, runInit, runCheck, runAttestAuth, promptForAnswers, internals: { usage, FLAGS } };
