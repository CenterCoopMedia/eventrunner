'use strict';

const { getDefaultTemplate } = require('../functions/src/email/templates.cjs');
const { initFirebase } = require('./lib/firebase-init.cjs');
const { SEED_ACTOR } = require('shared/seed');

const TEMPLATE_IDS = ['ticket.get_ticket', 'ticket.claim_prompt'];

/** Refresh only the two existing, unedited setup copies. Default: Read only. */
async function refreshTicketEmails({ db, dryRun = true, now = Date.now }) {
  const results = [];
  for (const id of TEMPLATE_IDS) {
    const template = getDefaultTemplate(id);
    const source = { subject: template.subject, html: template.html, text: template.text };
    const ref = db.collection('email_templates').doc(id);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { id, status: 'absent' };
      const saved = snap.data();
      if (saved.seeded !== true || saved.updatedBy !== SEED_ACTOR.email) return { id, status: 'edited' };
      if (Object.entries(source).every(([key, value]) => saved[key] === value)) return { id, status: 'current' };
      if (dryRun) return { id, status: 'would-refresh' };
      tx.update(ref, { ...source, updatedAt: new Date(now()) });
      return { id, status: 'refreshed' };
    });
    results.push(result);
  }
  return results;
}

async function main(argv) {
  if (argv.some((arg) => !['--dry-run', '--apply'].includes(arg)) || new Set(argv).size !== argv.length
      || (argv.includes('--apply') && argv.includes('--dry-run'))) {
    console.error('Usage: node scripts/refresh-ticket-emails.cjs [--dry-run | --apply]');
    return 2;
  }
  const dryRun = !argv.includes('--apply');
  const { db, projectId } = initFirebase();
  const results = await refreshTicketEmails({ db, dryRun });
  console.log(JSON.stringify({ projectId, dryRun, results }));
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch(() => {
    console.error('Ticket email refresh failed. Check the target and operator credentials.');
    process.exitCode = 1;
  });
}

module.exports = { refreshTicketEmails, main };
