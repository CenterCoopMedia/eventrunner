#!/usr/bin/env node
'use strict';

/**
 * Export a past event's reusable setup as a reviewable template file
 * (issue #328).
 *
 * Reads the project named by EVENT_FIREBASE_PROJECT_ID and writes nothing
 * to it. The template holds only what `scripts/lib/event-template.cjs`
 * allows: branding choices, page templates, the content blocks on those
 * pages, and selected static settings. Users, tickets, pitches,
 * credentials, the admin allowlist, email logs and every other record of
 * the past event stay in its own project.
 *
 * Run `--dry-run` first: it prints the inventory (what goes in, what stays
 * out, which stored files to copy by hand, which blocks still mention the
 * old event) and writes no file. Then export, review the JSON, and apply it
 * to a NEW project with `init-event.cjs --template <file>`.
 *
 * Usage:
 *   EVENT_FIREBASE_PROJECT_ID=<past event project> \
 *     node scripts/export-event-template.cjs --dry-run
 *   EVENT_FIREBASE_PROJECT_ID=<past event project> \
 *     node scripts/export-event-template.cjs --out past-event-template.json [--page home --page faq]
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { exportTemplate, formatInventory } = require('./lib/event-template.cjs');

const FLAGS = ['out', 'page', 'dry-run', 'help'];

function usage() {
  return [
    'Usage: node scripts/export-event-template.cjs (--dry-run | --out <file>) [--page <id>]...',
    '',
    '  --dry-run      print the inventory; write no file',
    '  --out <file>   write the template JSON here (refuses an existing file)',
    '  --page <id>    export only this page and its content; repeatable (default: every page)',
  ].join('\n');
}

/**
 * @param {{ db: object, projectId: string, args: object, now?: () => number }} args
 * @returns {Promise<number>} exit code
 */
async function runExport({ db, projectId, args, now = Date.now }) {
  const dryRun = Boolean(args['dry-run']);
  const out = typeof args.out === 'string' && args.out ? path.resolve(process.cwd(), args.out) : null;
  if (!dryRun && !out) {
    console.error(`Pass --dry-run to see the inventory, or --out <file> to write the template.\n\n${usage()}`);
    return 2;
  }
  if (out && !dryRun && fs.existsSync(out)) {
    console.error(`${out} already exists; choose a new file name.`);
    return 2;
  }
  const pageIds = Array.isArray(args.page) ? args.page.filter(Boolean) : [];
  const result = await exportTemplate({ db, projectId, pageIds, now });
  if (!result.ok) {
    console.error(`Export refused — no file written:\n  ${result.errors.join('\n  ')}`);
    return 2;
  }
  console.log(formatInventory(result.template));
  if (dryRun) {
    console.log('\n--dry-run: no file written.');
    return 0;
  }
  fs.writeFileSync(out, `${JSON.stringify(result.template, null, 2)}\n`, { flag: 'wx' });
  console.log(`\nWrote ${out}. Review it before you apply it to a new project.`);
  return 0;
}

async function main(argv) {
  const args = parseArgv(argv, { withValue: ['out'], repeatable: ['page'] });
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
  console.log(`export-event-template: project ${handles.projectId} (${handles.mode} credentials), read only\n`);
  return runExport({ db: handles.db, projectId: handles.projectId, args });
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`export-event-template: ${err.stack || err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, runExport, internals: { usage, FLAGS } };
