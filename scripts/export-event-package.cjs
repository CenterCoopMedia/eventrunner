#!/usr/bin/env node
'use strict';

/**
 * Event data package from a terminal (issue #329).
 *
 * The admin panel's **Download event data package** (operator tier) builds
 * the package inside a Cloud Function, which caps the response near 10 MB.
 * This script builds the same package with the same code
 * (functions/src/admin/eventPackage.cjs) and no cap, for a large event, and
 * checks a saved package with `--verify`.
 *
 * Credentials come from scripts/lib/firebase-init.cjs: the emulator, a
 * service-account key file, or application-default credentials, and the
 * project from EVENT_FIREBASE_PROJECT_ID. The account needs read access to
 * Firestore and write access to `admin_logs`.
 *
 * The script writes one admin_logs row (`downloadEventPackage`, with
 * `details.via: 'script'`) before it writes the file, as the endpoint
 * does. The file is written with owner-only permissions (0600).
 *
 * Usage:
 *   EVENT_FIREBASE_PROJECT_ID=… node scripts/export-event-package.cjs --out package.zip
 *   node scripts/export-event-package.cjs --out package.zip --sections program,speakers
 *   node scripts/export-event-package.cjs --out package.zip --include-staff-notes
 *   node scripts/export-event-package.cjs --verify package.zip
 *
 * Exit codes: 0 done (or verified), 1 the export or the check failed,
 * 2 a usage error.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgv, unknownFlags } = require('./lib/args.cjs');

const FLAGS = ['out', 'sections', 'include-staff-notes', 'verify', 'force', 'help'];

const USAGE = `Usage:
  node scripts/export-event-package.cjs --out <file.zip> [--sections a,b] [--include-staff-notes] [--force]
  node scripts/export-event-package.cjs --verify <file.zip>`;

/**
 * Turn argv into a plan, or the reason it is refused. Pure.
 *
 * @param {string[]} argv
 * @param {string[]} sectionIds the package's section ids
 * @returns {{ ok: true, mode: 'export', out: string, sections: string[], includeStaffNotes: boolean, force: boolean }
 *         | { ok: true, mode: 'verify', file: string } | { ok: true, mode: 'help' }
 *         | { ok: false, message: string }}
 */
function readArgs(argv, sectionIds) {
  const args = parseArgv(argv, { withValue: ['out', 'sections', 'verify'] });
  const unknown = unknownFlags(args, FLAGS);
  if (unknown.length > 0) return { ok: false, message: `Unknown flag: ${unknown.map((f) => `--${f}`).join(', ')}` };
  if (args.help) return { ok: true, mode: 'help' };
  if (args._.length > 0) return { ok: false, message: `Unexpected argument: ${args._.join(' ')}` };
  if (typeof args.verify === 'string') {
    if (!args.verify) return { ok: false, message: '--verify needs a file.' };
    if (args.out !== undefined) return { ok: false, message: 'Use --verify or --out, not both.' };
    return { ok: true, mode: 'verify', file: args.verify };
  }
  if (typeof args.out !== 'string' || !args.out) return { ok: false, message: '--out needs a file name ending in .zip.' };
  if (!args.out.endsWith('.zip')) return { ok: false, message: '--out must end in .zip.' };
  let sections = [...sectionIds];
  if (args.sections !== undefined) {
    sections = String(args.sections).split(',').map((id) => id.trim()).filter(Boolean);
    const unknownSections = sections.filter((id) => !sectionIds.includes(id));
    if (sections.length === 0 || unknownSections.length > 0) {
      return { ok: false, message: `--sections takes a comma-separated list of: ${sectionIds.join(', ')}.` };
    }
  }
  return {
    ok: true,
    mode: 'export',
    out: args.out,
    sections: sectionIds.filter((id) => sections.includes(id)),
    includeStaffNotes: args['include-staff-notes'] === true,
    force: args.force === true,
  };
}

/** The verify report as lines a person reads. Pure. */
function formatReport(report) {
  const lines = [];
  if (report.manifest) {
    lines.push(`Format ${report.manifest.format}, schema version ${report.manifest.schemaVersion}, exported ${report.manifest.exportedAt}.`);
  }
  for (const [file, count] of Object.entries(report.counts)) {
    lines.push(`  ${file}: ${count === null ? 'one document' : `${count} records`}`);
  }
  for (const rel of report.relationships) {
    const tail = rel.unresolved > 0 ? `, ${rel.unresolved} not found (for example ${rel.sample.join(', ')})` : '';
    lines.push(`  ${rel.from} ${rel.field} -> ${rel.to}: ${rel.checked} checked${tail}`);
  }
  if (report.ok) lines.push('The package is complete. Every file matches its checksum.');
  else lines.push('The package is damaged:', ...report.problems.map((problem) => `  ${problem}`));
  return lines;
}

async function main(argv = process.argv.slice(2), { stdout = console.log, stderr = console.error } = {}) {
  const { buildEventPackage, zipPackage, internals: { SECTION_IDS } } = require('../functions/src/admin/eventPackage.cjs');
  const plan = readArgs(argv, SECTION_IDS);
  if (!plan.ok) {
    stderr(plan.message);
    stderr(USAGE);
    return 2;
  }
  if (plan.mode === 'help') {
    stdout(USAGE);
    return 0;
  }
  if (plan.mode === 'verify') {
    const { verifyEventPackage } = require('../functions/src/admin/eventPackageReader.cjs');
    let buffer;
    try {
      buffer = fs.readFileSync(plan.file);
    } catch (err) {
      stderr(`${plan.file}: ${err.code === 'ENOENT' ? 'no such file' : err.message}`);
      return 1;
    }
    const report = verifyEventPackage(buffer);
    for (const line of formatReport(report)) (report.ok ? stdout : stderr)(line);
    return report.ok ? 0 : 1;
  }

  const out = path.resolve(plan.out);
  if (fs.existsSync(out) && !plan.force) {
    stderr(`${plan.out} exists. Choose another name, or pass --force to replace it.`);
    return 2;
  }
  const { initFirebase } = require('./lib/firebase-init.cjs');
  const { getEventConfig } = require('../functions/src/core/config.cjs');
  const { db, projectId, mode } = initFirebase();
  stdout(`Reading project ${projectId} (${mode}).`);
  const at = new Date();
  const config = await getEventConfig({ db, forceRefresh: true });
  const built = await buildEventPackage({
    db, config, sections: plan.sections, includeStaffNotes: plan.includeStaffNotes, at, maxDocs: Infinity,
  });
  const zip = await zipPackage({ name: built.name, files: built.files, at });
  await db.collection('admin_logs').doc().set({
    action: 'downloadEventPackage',
    docPath: 'event-package',
    uid: null,
    email: null,
    at,
    details: {
      via: 'script',
      sections: plan.sections,
      includeStaffNotes: plan.includeStaffNotes,
      files: built.manifest.files.map((file) => ({ path: file.path, records: file.records })),
      bytes: zip.length,
    },
  });
  fs.writeFileSync(out, zip, { mode: 0o600 });
  stdout(`Wrote ${plan.out}: ${built.manifest.files.length} files, ${zip.length} bytes.`);
  stdout('It holds personal data. Store it with access control, and delete it when the retention period ends.');
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }, (err) => {
    console.error(`The export failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, readArgs, formatReport, USAGE };
