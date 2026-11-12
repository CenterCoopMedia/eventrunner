#!/usr/bin/env node
'use strict';

// Host operator command: Firebase IAM credentials authorize the write.
// --actor identifies the operator in the same way as export-event-package.
// Procedure: docs/operator/client-email.md.
const fs = require('node:fs');
const { isUtf8 } = require('node:buffer');
const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { isBareEmailAddress, hasMailingAddress } = require('../packages/shared/src/email.cjs');

const FLAGS = ['sender-email', 'address-file', 'actor', 'dry-run', 'help'];
const USAGE = `Usage: EVENT_FIREBASE_PROJECT_ID=<project> node scripts/set-client-email.cjs
  --actor <your email> [--sender-email <address>] [--address-file <plain-text file>] [--dry-run]

Set either or both email settings with project-scoped Firebase IAM credentials.
The address file is plain text, up to 8 KiB. Each line becomes an escaped HTML line.
Verify a new sender domain with the email provider before changing the From address.
After an address change, run scripts/verify-sender-domain.cjs to record verification.
The client-admin API continues to refuse these settings.`;

function readArgs(argv) {
  const args = parseArgv(argv, { withValue: ['sender-email', 'address-file', 'actor'] });
  if (unknownFlags(args, FLAGS).length || args._.length) throw new Error('Unknown flag or unexpected argument.');
  if (args.help === true) return { help: true };
  const actor = typeof args.actor === 'string' ? args.actor.trim().toLowerCase() : '';
  if (!isBareEmailAddress(actor)) throw new Error('--actor needs the operator email address for the admin log.');
  const plan = { actor, dryRun: args['dry-run'] === true };
  if (args['dry-run'] !== undefined && args['dry-run'] !== true) throw new Error('--dry-run takes no value.');
  if (args['sender-email'] !== undefined) {
    const email = typeof args['sender-email'] === 'string' ? args['sender-email'].trim() : '';
    if (!isBareEmailAddress(email)) throw new Error('--sender-email needs one plain email address.');
    plan.senderEmail = email;
  }
  if (args['address-file'] !== undefined) {
    if (typeof args['address-file'] !== 'string' || !args['address-file']) throw new Error('--address-file needs a file.');
    plan.addressFile = args['address-file'];
  }
  if (!plan.senderEmail && !plan.addressFile) throw new Error('Choose --sender-email, --address-file, or both.');
  return plan;
}

function readAddress(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 8192) throw new Error('The mailing-address file must be a regular file up to 8 KiB.');
  const bytes = fs.readFileSync(file);
  if (bytes.length > 8192 || !isUtf8(bytes)) throw new Error('The mailing-address file must be UTF-8, up to 8 KiB.');
  const text = bytes.toString('utf8').replace(/\r\n?/g, '\n').trim();
  // Permit address line breaks and tabs, but refuse other ASCII controls.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || !text || /\[Replace/i.test(text)) {
    throw new Error('The mailing address must contain text without a placeholder or control characters.');
  }
  const escaped = text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const html = escaped.replace(/\n/g, '<br>');
  if (!hasMailingAddress(html)) throw new Error('The mailing address must contain visible text.');
  return html;
}

async function updateSettings({ db, plan, mode, now = () => new Date() }) {
  const ref = db.collection('config').doc('event');
  const audit = db.collection('admin_logs').doc();
  const at = now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('config/event does not exist. Set up this project first.');
    const stored = snap.data();
    const patch = {};
    const fields = [];
    if (plan.senderEmail && plan.senderEmail.toLowerCase() !== String(stored.sender?.email || '').trim().toLowerCase()) {
      patch.sender = {
        ...stored.sender, email: plan.senderEmail,
        domainVerified: false, domainVerifiedAt: null, domainVerifiedBy: null, domainVerifiedDomain: null,
      };
      fields.push('sender.email');
    }
    if (plan.postalAddressHtml !== undefined && plan.postalAddressHtml !== stored.legal?.postalAddressHtml) {
      patch.legal = { ...stored.legal, postalAddressHtml: plan.postalAddressHtml };
      fields.push('legal.postalAddressHtml');
    }
    if (fields.length && !plan.dryRun) {
      tx.set(ref, { ...patch, updatedAt: at, updatedBy: plan.actor }, { merge: true });
      tx.set(audit, {
        action: 'updateClientEmailSettings', docPath: 'config/event', uid: null, email: plan.actor, at,
        details: { via: 'script', credentials: mode, fields },
      });
    }
    return fields;
  });
}

async function main(argv = process.argv.slice(2), { env = process.env, init, stdout = console.log, stderr = console.error } = {}) {
  let plan;
  try {
    plan = readArgs(argv);
    if (plan.help) { stdout(USAGE); return 0; }
    if (!env.EVENT_FIREBASE_PROJECT_ID?.trim()) throw new Error('EVENT_FIREBASE_PROJECT_ID must name the client project.');
    if (plan.addressFile) plan.postalAddressHtml = readAddress(plan.addressFile);
  } catch (error) {
    stderr(error.message);
    return 2;
  }
  try {
    const { db, projectId, mode } = (init || require('./lib/firebase-init.cjs').initFirebase)({ env });
    const fields = await updateSettings({ db, plan, mode });
    stdout(`${plan.dryRun ? 'Preview' : 'Saved'} project ${projectId}: ${fields.length ? fields.join(', ') : 'no changes'}.`);
    return 0;
  } catch {
    // SDK errors can carry request details or credentials. Keep them off stdout/stderr.
    stderr('The email settings could not be saved. Check the project and Firebase IAM access.');
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });
module.exports = { main, readArgs, readAddress, updateSettings, USAGE };
