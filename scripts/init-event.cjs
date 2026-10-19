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
 *   c. writes `config/bootstrap` from `--admin` and `--staff` flags — the
 *      single source of admin identity for the whole platform
 *      (functions/src/core/auth.cjs requireAdmin, firestore.rules isAdmin,
 *      and the web AuthContext probe all read it; nothing reads an
 *      ADMIN_EMAILS env var any more). `adminEmails` is the operator tier
 *      and `staffEmails` the staff tier (issue #186); later grants happen
 *      in the admin's Access page, and a re-run never removes them;
 *   d. seeds `cmsPages` with the fifteen default pages (§5.3);
 *   e. seeds `cmsContent` with placeholder blocks for every `defaultBlocks`
 *      entry, and the two legal pages from the provider-aware templates
 *      (§5.4, §5.5);
 *   f. seeds `email_templates` overrides for the two client-visible
 *      templates whose copy is event-specific (`ticket.get_ticket`,
 *      `ticket.claim_prompt`); every other shipped template runs from its
 *      code default, no override doc (§6.3);
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
 * With `--template <file>` (issue #328) the run seeds a NEW event from a
 * template `export-event-template.cjs` read out of a past event's project:
 * its reviewed branding, page templates and selected static settings. The
 * template applies only to a fresh, empty project that is not the source
 * project, never under `--force`, and only when the answers file gives the
 * new event its own dates and a named owner who is one of its operators.
 * Every other launch check (sender domain, providers, Auth, billing) starts
 * unmet in the new project, as on any fresh deployment.
 *
 * Usage:
 *   node scripts/init-event.cjs --answers client-answers.json --admin ops@example.org
 *   node scripts/init-event.cjs --answers next-answers.json --admin ops@example.org --template past.json
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
const {
  defaultPages, buildSeedContent, buildLegalContentDocs, buildEmailTemplateSeeds, OBSOLETE_CONTENT_IDS,
  REPLACED_CONTENT_IDS,
} = require('./lib/seed.cjs');
const { validatePageDoc } = require('../functions/src/cms/pages.cjs');
const { getTierA } = require('../functions/src/core/config.cjs');
const { evaluateReadiness, allReady, formatReadinessTable, DEFAULT_SEEDED_THRESHOLD } =
  require('./lib/readiness.cjs');
const { manualChecklist, formatChecklist } = require('./lib/checklist.cjs');
const {
  parseTemplateFile, mergeTemplateAnswers, templateApplyErrors, mergeTemplatePages, mergeTemplateContent,
  templateReadinessRows, formatInventory, pageSetErrors, isConfigDerived, EXCLUDED_REASONS,
} = require('./lib/event-template.cjs');
const { validateDeployEnv } = require('shared/config');
const { uploadPlaceholderBranding } = require('./lib/branding.cjs');
const {
  writeConfigDocs, seedCollection, removeObsoleteSeeds, withholdUpgradeSeeds, findPagePathCollisions,
  findPageSectionCollisions,
  seedEmailTemplateOverrides, countSeeded, readConfig,
} = require('./lib/write.cjs');

const FLAGS = [
  'answers', 'admin', 'staff', 'force', 'check', 'attest-auth', 'dry-run',
  'skip-branding', 'seeded-threshold', 'template', 'help',
];

/**
 * Collections a template target must not hold anything in: every collection
 * the template export names (EXCLUDED_REASONS: the schedule, organizations,
 * timeline, updates, accounts, orders, logs and the rest) and the ones the
 * apply writes. A fresh project has none of these; one that does is either
 * the wrong project or an event that already started, and a template must
 * never merge into either. On a real project, listCollections() adds any
 * collection no list names yet.
 */
const TEMPLATE_TARGET_EMPTY = Object.freeze([...new Set([
  'config', 'cmsPages', 'cmsPages_drafts', 'cmsContent', 'cmsContent_drafts', 'email_templates',
  ...Object.keys(EXCLUDED_REASONS),
])]);

/**
 * What a template apply itself writes. A project whose apply stopped part
 * way holds only these, and a rerun with the same template may resume it.
 */
const TEMPLATE_APPLY_WRITES = Object.freeze([
  'config', 'cmsPages', 'cmsPages_drafts', 'cmsContent', 'cmsContent_drafts', 'email_templates',
  // cmsMeta/pending, the unpublished-change count the publish keeps.
  'cmsMeta',
]);
const TEMPLATE_APPLY_CONFIG = Object.freeze(['event', 'features', 'theme', 'badges', 'providers', 'bootstrap', 'template']);

function usage() {
  return [
    'Usage: node scripts/init-event.cjs [options]',
    '',
    '  --answers <file>        client answers JSON (otherwise prompts interactively)',
    '  --admin <email>         first operator address; repeatable',
    '  --staff <email>         staff address (content, schedule, speakers, attendees); repeatable',
    '  --force                 re-run against a project that already has config/event',
    '                          (client-edited documents are still never overwritten)',
    '  --check                 read-only launch-readiness check; exits non-zero if unmet',
    '  --attest-auth           record that the manual Firebase Auth steps are done',
    '  --dry-run               report every write without performing it',
    '  --skip-branding         do not upload the placeholder branding assets',
    '  --seeded-threshold <n>  how many seeded blocks --check tolerates (default 0)',
    '  --template <file>       seed a fresh project from an event template',
    '                          (export-event-template.cjs); needs new dates and an owner',
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
  const rows = [...evaluateReadiness(snapshot), ...templateReadinessRows(snapshot)];
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

/**
 * Load a template and check the target before anything is written.
 *
 * An apply is several writes, not one transaction. Its first write is
 * `config/template` with status 'applying', and its last write sets
 * 'applied'. A project left at 'applying' by a failed run may be resumed by
 * the SAME template (same source project, same export time), as long as it
 * holds nothing an apply does not write.
 *
 * @returns {Promise<{ ok: true, template: object, resume: boolean } | { ok: false }>}
 */
async function loadTemplateForTarget({ db, file, force, tierA, listAuthUsers }) {
  const resolved = path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolved)) {
    console.error(`Template file not found: ${resolved}`);
    return { ok: false };
  }
  const parsed = parseTemplateFile(fs.readFileSync(resolved, 'utf8'));
  if (!parsed.ok) {
    console.error(`Template rejected — nothing was written:\n  ${parsed.errors.join('\n  ')}`);
    return { ok: false };
  }
  const { template } = parsed;
  if (force) {
    console.error('--template applies only to a fresh project; it cannot be combined with --force.');
    return { ok: false };
  }
  if (template.source.projectId === tierA.projectId) {
    console.error(
      `The template was exported from ${tierA.projectId}, the project this run targets. ` +
      'Each event needs its own project: create a new one and point EVENT_FIREBASE_PROJECT_ID at it.',
    );
    return { ok: false };
  }
  const marker = await db.collection('config').doc('template').get();
  let resume = false;
  if (marker.exists) {
    const prior = marker.data();
    const same = prior.sourceProjectId === template.source.projectId
      && prior.exportedAt === (template.source.exportedAt || null);
    if (prior.status === 'applied') {
      console.error(
        `${tierA.projectId} was already made from a template (${prior.sourceProjectId}); it is already applied. ` +
        'Edit the event in the admin, or run init without --template to refresh its seed.',
      );
      return { ok: false };
    }
    if (!same) {
      console.error(
        `${tierA.projectId} holds an unfinished apply of a different template (${prior.sourceProjectId}, ` +
        `exported ${prior.exportedAt}). Run that template again to finish it — nothing was written.`,
      );
      return { ok: false };
    }
    resume = true;
  }
  const occupied = [];
  const names = new Set(TEMPLATE_TARGET_EMPTY);
  if (typeof db.listCollections === 'function') {
    for (const ref of await db.listCollections()) names.add(ref.id);
  }
  for (const name of names) {
    if (resume && TEMPLATE_APPLY_WRITES.includes(name)) continue;
    const snap = await db.collection(name).limit(1).get();
    if (!snap.empty) occupied.push(name);
  }
  if (resume) {
    const configSnap = await db.collection('config').get();
    for (const doc of configSnap.docs) {
      if (!TEMPLATE_APPLY_CONFIG.includes(doc.id)) occupied.push(`config/${doc.id}`);
    }
  }
  if (occupied.length > 0) {
    console.error(
      `${tierA.projectId} is not empty (${occupied.join(', ')}). ` +
      'A template applies only to a fresh project — nothing was written.',
    );
    return { ok: false };
  }
  // Accounts live in Firebase Authentication, not Firestore. The check runs
  // where the Admin SDK can list them (a real project, or the Auth
  // emulator); elsewhere the operator is told to confirm it by hand.
  if (typeof listAuthUsers === 'function') {
    let users;
    try {
      users = await listAuthUsers();
    } catch (err) {
      console.error(`Cannot list Firebase Authentication accounts (${err.message}) — nothing was written.`);
      return { ok: false };
    }
    if (users.length > 0) {
      console.error(
        `${tierA.projectId} already has Firebase Authentication accounts. ` +
        'A template applies only to a fresh project — nothing was written.',
      );
      return { ok: false };
    }
  } else {
    console.warn(
      'warning: Firebase Authentication accounts were not checked here; confirm in the console that ' +
      'this project has none.',
    );
  }
  if (resume) console.log(`${tierA.projectId}: resuming the apply of the same template.`);
  return { ok: true, template, resume };
}

async function runInit({
  db, store, bucket, args, tierA, env = process.env, now = Date.now, listAuthUsers = null,
}) {
  const dryRun = Boolean(args['dry-run']);
  const userForce = Boolean(args.force);

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

  // A template (issue #328) is checked against the target before answers
  // are read: the same project, a used project, or --force stops the run.
  let template = null;
  let resume = false;
  if (args.template !== undefined) {
    if (typeof args.template !== 'string' || !args.template) {
      console.error('--template needs a file path.');
      return 2;
    }
    const loaded = await loadTemplateForTarget({
      db, file: args.template, force: userForce, tierA, listAuthUsers,
    });
    if (!loaded.ok) return 2;
    template = loaded.template;
    resume = loaded.resume;
  }
  // Resuming an unfinished apply refreshes what that apply wrote, by the
  // same seeded-flag rules a --force re-run follows.
  const force = userForce || resume;

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
  const staffFlags = Array.isArray(args.staff) ? args.staff : (args.staff ? [args.staff] : []);
  if (staffFlags.length > 0) answers.staffEmails = staffFlags;

  if (template) {
    // The answers file wins over the template, field by field.
    answers = mergeTemplateAnswers(template, answers);
    const adminEmails = (answers.adminEmails || []).map((e) => String(e).trim().toLowerCase());
    const gate = templateApplyErrors({ template, answers, adminEmails });
    if (gate.length > 0) {
      console.error(`\nTemplate needs more from the answers file — nothing was written:\n  ${gate.join('\n  ')}`);
      return 2;
    }
  }

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
  const basePages = template
    ? mergeTemplatePages({ templatePages: template.pages, defaults: defaultPages() })
    : defaultPages();
  const pages = basePages.map((page) => ({ ...page, seeded: true }));
  const pageErrors = template ? pageSetErrors(basePages) : [];
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

  // Bootstrap the one pending-count document before any CMS seed transition.
  // On an upgrade this counts existing dirty drafts first; every seed save,
  // publish, and delete below then changes the count atomically through store.
  // A dry run remains read-only and leaves a missing document for the deployed
  // cmsEnsurePendingCounts endpoint to prepare.
  // A template apply's first write marks it unfinished, so a failed run can
  // be resumed by the same template and by nothing else.
  let templateDoc = null;
  if (template) {
    templateDoc = {
      kind: template.kind,
      status: 'applying',
      sourceProjectId: template.source.projectId,
      sourceEventName: template.source.eventName || '',
      sourceDays: template.source.days,
      exportedAt: template.source.exportedAt || null,
      startedAt: new Date(now()).toISOString(),
      appliedAt: null,
      owner: { name: answers.owner.name.trim(), email: answers.owner.email.trim().toLowerCase() },
    };
    if (!dryRun) await db.collection('config').doc('template').set(templateDoc);
  }

  if (!dryRun) await store.ensurePendingCounts({ db, now });

  // On a re-run, only the explicit flags may add to config/bootstrap: the
  // answers file's lists seeded the first run and are not re-applied, so
  // an address an operator removed or demoted on the Access page stays
  // where the operator put it (write.cjs writeConfigDocs).
  const bootstrapAdditions = { adminEmails: adminFlags, staffEmails: staffFlags };
  const { results: configResults, effective } = await writeConfigDocs({
    db, docs, force, dryRun, now, bootstrapAdditions,
  });
  if (templateDoc) {
    configResults.unshift({
      docId: 'template',
      action: resume ? 'overwrite' : 'create',
      reason: `${resume ? 'resumed' : 'started'} from ${templateDoc.sourceProjectId}`,
    });
  }
  for (const r of configResults) {
    let note = r.reason;
    if (r.docId === 'bootstrap' && r.added) {
      const parts = [];
      if (r.added.adminEmails.length > 0) parts.push(`added operators: ${r.added.adminEmails.join(', ')}`);
      if (r.added.staffEmails.length > 0) parts.push(`added staff: ${r.added.staffEmails.join(', ')}`);
      note = parts.length > 0
        ? parts.join('; ')
        : 'no accounts added; a re-run adds only --admin and --staff, never the answers file';
    }
    console.log(`  config/${r.docId.padEnd(9)} ${r.action} (${note})`);
  }

  // Path-collision preflight (Codex review, seed a recap page and a
  // guidelines page: P1): seedCollection decides purely by doc id, so it
  // cannot see a DIFFERENT page id already sitting on the path a seeded
  // page wants — including under --force, which only relaxes the
  // already-initialized refusal, never this. Every seeded page is
  // checked, not only the two most recently added ones: a client's own
  // page reassignment could just as easily collide with 'travel' or
  // 'faq'. A colliding page is left out of the write entirely and
  // reported the same way every other skip already is.
  const pathCollisions = await findPagePathCollisions({ db, pages: pageDocs });
  // Section-id collision preflight (Codex review, seed a city guide page:
  // P2): cmsContent is keyed globally by section id, so a seeded page's
  // section ids can just as easily collide with a DIFFERENT page's own
  // sections, or with content orphaned by an earlier page's deletion, as a
  // path can. Same treatment as the path check: a colliding page is left
  // out of the write entirely, checked across every seeded page.
  const sectionCollisions = await findPageSectionCollisions({ db, pages: pageDocs });
  const collisionSkips = [
    ...[...pathCollisions].map(([id, collision]) => ({
      id,
      reason: `path ${collision.path} is already owned by page '${collision.ownerId}' — not seeded`,
    })),
    ...[...sectionCollisions].map(([id, collision]) => ({
      id,
      reason: collision.ownerId
        ? `section '${collision.sectionId}' is already owned by page '${collision.ownerId}' — not seeded`
        : `section '${collision.sectionId}' is orphaned content from a deleted page — not seeded`,
    })),
  ];
  const seedablePages = pageDocs.filter(
    (page) => !pathCollisions.has(page.id) && !sectionCollisions.has(page.id),
  );

  // Content is derived from the EFFECTIVE config, not from what was
  // proposed: on a --force re-run the merge rules keep the stored auth
  // attestation and legal review flag, and the §5.5 legal templates read
  // exactly those. Building from `docs` would regenerate the privacy page
  // as if Google sign-in had never been enabled.
  //
  // AND FROM THE PAGES ACTUALLY BEING SEEDED, not from every default page
  // (Codex review, the sponsor strip). cmsContent is a separate write from
  // cmsPages, so content built from the full default set would still file
  // every block of a page the preflight just skipped — and the reason it
  // was skipped is precisely that somebody else owns those section ids,
  // which is where those blocks would land: editable content on a page
  // nobody seeded. A page left out of the seed is left out of it whole.
  const generated = buildSeedContent({ pages: seedablePages, docs: effective, tierA, seededAt });
  // A template page keeps the template's own blocks, but a block init
  // derives from configuration (the title, the dates) is built again from
  // the new event's configuration, never carried from the old one.
  const content = template
    ? mergeTemplateContent({
      generated,
      template: { ...template, pages: template.pages.filter((p) => seedablePages.some((s) => s.id === p.id)) },
      configDerived: buildSeedContent({ pages: defaultPages(), docs: effective, tierA, seededAt })
        .filter((doc) => isConfigDerived(doc)
          && seedablePages.some((page) => page.sections.some((sec) => sec.id === doc.section))),
      seededAt,
    })
    : generated;

  // A refresh keeps each page's stored visibility (seedCollection
  // keepStored): pages this release seeds hidden stay visible on a site an
  // earlier release seeded them visible on.
  const pageResult = await seedCollection({
    db, store, collection: 'cmsPages', docs: seedablePages, dryRun, now, force, keepStored: ['visible'],
  });
  pageResult.skipped = [...collisionSkips, ...pageResult.skipped];
  console.log(
    `  cmsPages          ${pageResult.created.length} created, ${pageResult.refreshed.length} refreshed, ` +
    `${pageResult.skipped.length} left alone`,
  );
  for (const s of pageResult.skipped) console.log(`    - ${s.id}: ${s.reason}`);

  // THE UPGRADE RULE FOR NEW CONTENT (adversarial review of the 2026-09-10
  // wave). A block this release seeds and the site does not have is not
  // simply created: a replacement for blocks the client has edited would
  // state the same thing twice, and a placeholder published into a section
  // the client has written is a "[Replace]" line on a live page. Both are
  // withheld and reported, the way an obsolete seed the client owns is.
  const upgrade = await withholdUpgradeSeeds({
    db, collection: 'cmsContent', docs: content, replacedBy: REPLACED_CONTENT_IDS,
  });
  const contentResult = await seedCollection({
    db, store, collection: 'cmsContent', docs: upgrade.docs, dryRun, now, force,
  });
  console.log(
    `  cmsContent        ${contentResult.created.length} created, ${contentResult.refreshed.length} refreshed, ` +
    `${contentResult.skipped.length + upgrade.withheld.length} left alone`,
  );
  for (const w of upgrade.withheld) console.log(`    - ${w.id}: not created (${w.reason})`);

  // (e, continued) UPGRADE CLEANUP. A block this release no longer seeds is
  // still sitting on every site an earlier release initialized: seeding
  // writes and refreshes, it never deletes, and it only looks at the ids it
  // was handed. Left alone, `hero__register_cta` keeps drawing the dead
  // Register button the configured registration action replaced. Only
  // seed-owned documents go — `removeObsoleteSeeds` asks `decideSeedWrite`,
  // the same question every seed write asks — and what went is printed,
  // because a delete an operator cannot see in the output is a delete they
  // cannot undo.
  // A predecessor whose replacement was withheld stays whole, edited or
  // not: removing the still-seeded address line beside the client's venue
  // line would lose the address the withheld fact was to carry.
  const protectedIds = new Set(upgrade.protected);
  const obsolete = await removeObsoleteSeeds({
    db, store, collection: 'cmsContent', dryRun,
    docIds: OBSOLETE_CONTENT_IDS.filter((id) => !protectedIds.has(id)),
  });
  for (const id of obsolete.removed) {
    console.log(`    - ${id}: removed (this release no longer seeds it)`);
  }
  for (const k of obsolete.kept) {
    console.log(`    - ${k.id}: no longer seeded, kept (${k.reason})`);
  }
  for (const id of upgrade.protected) {
    console.log(`    - ${id}: no longer seeded, kept (its replacement was withheld)`);
  }

  // (f) email_templates overrides for the two client-visible templates
  // (§5.1 step f, §6.3). Same idempotency rule as every other seed: a
  // still-seeded doc refreshes, a client-edited one is left alone.
  const emailTemplateDocs = buildEmailTemplateSeeds({ seededAt });
  const emailTemplateResult = await seedEmailTemplateOverrides({
    db, docs: emailTemplateDocs, dryRun, now, force,
  });
  console.log(
    `  email_templates   ${emailTemplateResult.created.length} created, ` +
    `${emailTemplateResult.refreshed.length} refreshed, ${emailTemplateResult.skipped.length} left alone`,
  );
  for (const s of emailTemplateResult.skipped) console.log(`    - ${s.id}: ${s.reason}`);

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

  // Every write of the apply has landed: mark it finished. Until this
  // write, the same command can be run again to resume (loadTemplateForTarget).
  if (templateDoc) {
    templateDoc.status = 'applied';
    templateDoc.appliedAt = new Date(now()).toISOString();
    if (!dryRun) {
      await db.collection('config').doc('template').update({ status: 'applied', appliedAt: templateDoc.appliedAt });
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

  if (template) {
    console.log('\nTemplate reuse\n');
    console.log(formatInventory(template));
    console.log(
      '\nThis project starts its own launch checks: confirm its billing account, verify the sender ' +
      'domain, set up the providers, and attest Auth here, even where the source event passed them. ' +
      'Every reused block counts as seeded until an editor saves it.',
    );
  }

  const seededContentCount = dryRun ? content.length : await countSeeded({ db });
  reportReadiness(
    {
      event: effective.event,
      providers: effective.providers,
      theme: effective.theme,
      bootstrap: effective.bootstrap,
      template: templateDoc,
      seededContentCount,
      seededThreshold: DEFAULT_SEEDED_THRESHOLD,
    },
    { gate: false },
  );
  console.log('\ninit-event: done.');
  return 0;
}

async function main(argv) {
  const args = parseArgv(argv, {
    withValue: ['answers', 'seeded-threshold', 'template'], repeatable: ['admin', 'staff'],
  });
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
  // Listing Auth accounts needs real credentials or the Auth emulator. Under
  // the Firestore emulator alone there is nothing to ask, so the template
  // apply warns instead (loadTemplateForTarget).
  const { usingEmulator } = require('./lib/firebase-init.cjs');
  const canListAuth = !usingEmulator(process.env) || Boolean((process.env.FIREBASE_AUTH_EMULATOR_HOST || '').trim());
  const listAuthUsers = canListAuth
    ? async () => {
      const { getAuth } = require('firebase-admin/auth');
      return (await getAuth(handles.app).listUsers(1)).users;
    }
    : null;
  return runInit({ db, store, bucket, args, tierA, listAuthUsers });
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
