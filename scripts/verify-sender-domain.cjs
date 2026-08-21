#!/usr/bin/env node
'use strict';

/**
 * Sender-domain verification (spec §5.1 step 7, §5.6 item 4; issue #9).
 *
 * Wraps the configured EmailProvider's `verifySenderDomain()` as an
 * operator command, because that check is an onboarding checklist item,
 * not a code path any request takes: SPF, DKIM, and DMARC are published in
 * the client's DNS by a human, and somebody has to be able to ask "did
 * that land yet?" from a terminal. It matters more than it sounds —
 * emailed one-time codes are the platform's only sign-in path that depends
 * on mail, and an unauthenticated sender domain is exactly the condition
 * that gets those codes quarantined by institutional mail filters.
 *
 * The domain comes from `config/event.sender.email` unless `--domain` is
 * given, so the thing verified is the thing the platform actually sends
 * from rather than whatever an operator typed.
 *
 * On a pass, `config/event.sender.domainVerified/domainVerifiedAt` are
 * stamped — this script is the ONLY writer of that pair (§1.3, enforced on
 * the admin side by admin/config.cjs rejecting it from panel payloads), and
 * it is what clears the launch-readiness sender row.
 *
 * Exit codes: 0 verified, 1 not verified (or unknown), 2 misconfigured.
 *
 * Usage:
 *   EVENT_EMAIL_PROVIDER=postmark EMAIL_PROVIDER_API_KEY=… \
 *   EMAIL_ACCOUNT_API_KEY=… node scripts/verify-sender-domain.cjs
 *
 *   node scripts/verify-sender-domain.cjs --domain example.org --no-write
 */

const { parseArgv, unknownFlags } = require('./lib/args.cjs');

const FLAGS = ['domain', 'no-write', 'help'];

function usage() {
  return [
    'Usage: node scripts/verify-sender-domain.cjs [--domain <domain>] [--no-write]',
    '',
    '  --domain <domain>  verify this domain instead of config/event.sender.email',
    '  --no-write         report only; do not stamp config/event.sender',
    '',
    'Environment (Tier A, .env.example):',
    '  EVENT_EMAIL_PROVIDER      postmark | webhook | console',
    '  EMAIL_PROVIDER_API_KEY    server token, when the provider is postmark',
    '  EMAIL_ACCOUNT_API_KEY     account token — postmark reports domain state only to this one',
    '  EVENT_FIREBASE_PROJECT_ID the project whose config/event is read and stamped',
  ].join('\n');
}

/** One status line per DNS record, aligned. */
function formatStatus(status) {
  const mark = (v) => (v === 'pass' ? 'pass   ' : v === 'fail' ? 'FAIL   ' : 'unknown');
  return [
    `  Domain:      ${status.domain}`,
    `  SPF:         ${mark(status.spf)}`,
    `  DKIM:        ${mark(status.dkim)}`,
    `  Return-Path: ${mark(status.returnPath)}`,
    `  Verified:    ${status.verified ? 'YES' : 'no'}`,
    status.detail ? `  Detail:      ${status.detail}` : null,
  ].filter(Boolean).join('\n');
}

/** Remediation text for whatever is not passing yet. */
function remediation(status) {
  const lines = [];
  if (status.spf !== 'pass') lines.push('  - Publish the provider SPF record (or include) on the sender domain.');
  if (status.dkim !== 'pass') lines.push('  - Publish the provider DKIM TXT record and confirm it in the provider console.');
  if (status.returnPath !== 'pass') lines.push('  - Publish the return-path CNAME so bounces are authenticated.');
  lines.push('  - Publish a DMARC policy (§5.6 item 4), then re-run this script.');
  return lines.join('\n');
}

async function run({ args, env = process.env, deps = {} }) {
  const { getEmailProvider } = deps.getEmailProvider
    ? deps
    : require('../functions/src/email/providers/index.cjs');

  let provider;
  try {
    provider = getEmailProvider({ env });
  } catch (err) {
    console.error(`Email provider not configured: ${err.message}`);
    return 2;
  }

  if (typeof provider.verifySenderDomain !== 'function') {
    // console and webhook providers have no domain to verify. That is a
    // clean "not applicable", not a failure — same shape §5.1 step 8 uses
    // for ticketing providers with no webhook.
    console.log(`Provider "${provider.name}" does not verify sender domains — nothing to check.`);
    return 0;
  }

  const initFirebase = deps.initFirebase || require('./lib/firebase-init.cjs').initFirebase;
  let db = null;
  let configuredDomain = null;
  let senderEmail = null;
  if (!args.domain || !args['no-write']) {
    try {
      ({ db } = initFirebase({ env }));
      const snap = await db.collection('config').doc('event').get();
      senderEmail = snap.exists ? snap.data()?.sender?.email || null : null;
      configuredDomain = senderEmail ? senderEmail.split('@')[1] || null : null;
    } catch (err) {
      if (!args.domain) {
        console.error(`Cannot read config/event to find the sender domain: ${err.message}`);
        return 2;
      }
      console.warn(`warning: config/event unreadable (${err.message}); reporting only.`);
    }
  }

  const domain = (typeof args.domain === 'string' && args.domain) || configuredDomain;
  if (!domain) {
    console.error('No sender domain: config/event.sender.email is unset and --domain was not passed.');
    return 2;
  }
  if (configuredDomain && domain !== configuredDomain) {
    console.warn(
      `warning: verifying ${domain}, but this deployment sends from ${senderEmail} (${configuredDomain}).`,
    );
  }

  console.log(`\nSender domain verification (provider: ${provider.name})\n`);
  let status;
  try {
    status = await provider.verifySenderDomain(domain);
  } catch (err) {
    console.error(`Provider check failed: ${err.message}`);
    return 2;
  }
  console.log(formatStatus(status));

  if (!status.verified) {
    console.log('\nNot verified yet. To fix:\n');
    console.log(remediation(status));
    console.log('\nUntil this passes, emailed sign-in codes are unreliable (spec §5.6 item 4).');
    return 1;
  }

  if (args['no-write'] || !db || domain !== configuredDomain) {
    console.log('\nVerified. (config/event not stamped: --no-write, no database handle, or a different domain.)');
    return 0;
  }
  const verifiedAt = new Date().toISOString();
  await db.collection('config').doc('event').set(
    { sender: { domainVerified: true, domainVerifiedAt: verifiedAt } },
    { merge: true },
  );
  console.log(`\nVerified. Stamped config/event.sender.domainVerifiedAt = ${verifiedAt}.`);
  return 0;
}

async function main(argv) {
  const args = parseArgv(argv, { withValue: ['domain'] });
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const unknown = unknownFlags(args, FLAGS);
  if (unknown.length > 0) {
    console.error(`Unknown flag(s): ${unknown.map((f) => `--${f}`).join(', ')}\n\n${usage()}`);
    return 2;
  }
  return run({ args });
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`verify-sender-domain: ${err.stack || err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, run, internals: { formatStatus, remediation, usage, FLAGS } };
