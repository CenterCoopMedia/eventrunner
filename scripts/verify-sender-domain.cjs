#!/usr/bin/env node
'use strict';

/**
 * Sender-domain verification (spec §5.1 step 7, §5.6 item 4; issue #9).
 *
 * Wraps the configured EmailProvider's `verifySenderDomain()` as an
 * operator command, because that check is an onboarding checklist item,
 * not a code path any request takes: DKIM, the return-path CNAME, and DMARC
 * are published in the client's DNS by a human, and somebody has to be able
 * to ask "did that land yet?" from a terminal. It matters more than it sounds —
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

const FLAGS = ['domain', 'no-write', 'attest', 'help'];

/**
 * Stamp (or clear) `config/event.sender` verification.
 *
 * One writer, one shape: `verified` records how the verdict was reached,
 * so a later reader can tell a provider check from an operator's word.
 *
 * @param {{ db: object, verified: boolean, method: string, domain: string,
 *           now?: () => number }} args
 * @returns {Promise<string|null>} the ISO stamp written, or null on clear
 */
async function stampVerification({ db, verified, method, domain, now = Date.now }) {
  const at = verified ? new Date(now()).toISOString() : null;
  await db.collection('config').doc('event').set(
    {
      sender: {
        domainVerified: verified,
        domainVerifiedAt: at,
        domainVerifiedBy: verified ? method : null,
        domainVerifiedDomain: verified ? domain : null,
      },
    },
    { merge: true },
  );
  return at;
}

/**
 * True when the provider gave a DEFINITIVE negative — at least one record
 * actually failed, as opposed to the provider being unable to tell.
 *
 * The distinction decides whether a previously recorded pass is cleared:
 * "DKIM is failing" is news that invalidates it, while "no account token,
 * everything unknown" says nothing about the domain and must not silently
 * un-verify a deployment that is fine.
 *
 * SPF is excluded on purpose: it is informational only (issue #93), so a
 * reported SPF failure alongside passing DKIM and return-path is not a
 * reason to tear down a verification the gate itself still considers good.
 *
 * @param {{ spf?: string, dkim: string, returnPath: string }} status
 * @returns {boolean}
 */
function isDefinitiveFailure(status) {
  return [status.dkim, status.returnPath].includes('fail');
}

function usage() {
  return [
    'Usage: node scripts/verify-sender-domain.cjs [--domain <domain>] [--no-write]',
    '',
    '  --domain <domain>  verify this domain instead of config/event.sender.email',
    '  --no-write         report only; do not stamp config/event.sender',
    '  --attest           record an operator attestation, for providers with no',
    '                     domain API (webhook, console) — otherwise their',
    '                     deployments could never satisfy launch readiness',
    '',
    'Environment (Tier A, .env.example):',
    '  EVENT_EMAIL_PROVIDER      postmark | webhook | console',
    '  EMAIL_PROVIDER_API_KEY    server token, when the provider is postmark',
    '  EMAIL_ACCOUNT_API_KEY     account token — postmark reports domain state only to this one',
    '  EVENT_FIREBASE_PROJECT_ID the project whose config/event is read and stamped',
  ].join('\n');
}

/**
 * One status line per DNS record, aligned.
 *
 * SPF is printed with its verdict but labelled informational: Postmark's
 * Domains API deprecates the field and satisfies SPF through the
 * return-path CNAME, so it is reported, never gated on (issue #93).
 */
function formatStatus(status) {
  const mark = (v) => (v === 'pass' ? 'pass   ' : v === 'fail' ? 'FAIL   ' : 'unknown');
  return [
    `  Domain:      ${status.domain}`,
    `  SPF:         ${mark(status.spf)} (informational — satisfied via the return-path CNAME)`,
    `  DKIM:        ${mark(status.dkim)}`,
    `  Return-Path: ${mark(status.returnPath)}`,
    `  Verified:    ${status.verified ? 'YES' : 'no'}`,
    status.detail ? `  Detail:      ${status.detail}` : null,
  ].filter(Boolean).join('\n');
}

/**
 * Remediation text for whatever is not passing yet.
 *
 * There is deliberately no "publish an SPF record" step: the provider no
 * longer asks for one (issue #93), and sending an operator to add a record
 * that cannot change the verdict is the exact wild-goose chase this script
 * exists to prevent. A non-passing SPF gets a note saying so, nothing more.
 */
function remediation(status) {
  const lines = [];
  if (status.dkim !== 'pass') lines.push('  - Publish the provider DKIM TXT record and confirm it in the provider console.');
  if (status.returnPath !== 'pass') lines.push('  - Publish the return-path CNAME so bounces are authenticated.');
  lines.push('  - Publish a DMARC policy (§5.6 item 4), then re-run this script.');
  if (status.spf !== 'pass') {
    lines.push(
      '  - (SPF needs no action: it is informational here, satisfied through the',
      '    return-path CNAME. Do not publish a separate SPF record for it.)',
    );
  }
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

  const canVerify = typeof provider.verifySenderDomain === 'function';

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

  if (!canVerify) {
    // `webhook` and `console` expose no domain API. Left there, the
    // launch-readiness sender row could never pass and every webhook
    // deployment would be permanently unlaunchable — a gate nobody can
    // clear teaches operators to ignore the gate. So the same escape the
    // Auth row uses applies: the operator attests, in writing, on the
    // record, after checking the relay's DNS themselves.
    const domain = (typeof args.domain === 'string' && args.domain) || configuredDomain;
    console.log(`Provider "${provider.name}" exposes no sender-domain API — nothing to check automatically.`);
    if (!args.attest) {
      console.log(
        '\nThis deployment sends through a relay this platform cannot query, so launch readiness needs\n' +
        'your word instead of the provider\'s. Confirm SPF, DKIM, and DMARC for ' +
        `${domain || 'the sender domain'} in the client DNS, then record it:\n` +
        '\n  node scripts/verify-sender-domain.cjs --attest\n',
      );
      return 0;
    }
    if (!domain) {
      console.error('Cannot attest: config/event.sender.email is unset and --domain was not passed.');
      return 2;
    }
    if (args['no-write'] || !db) {
      console.log('--no-write: attestation not recorded.');
      return 0;
    }
    const at = await stampVerification({ db, verified: true, method: 'operator-attested', domain });
    console.log(`\nRecorded operator attestation for ${domain} at ${at}.`);
    return 0;
  }

  if (args.attest) {
    console.error(
      `Provider "${provider.name}" can verify the domain itself — run without --attest.\n` +
      'Attestation exists only for providers with no domain API.',
    );
    return 2;
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
    // A definitive failure on the domain this deployment actually sends
    // from invalidates any previously recorded pass. Leaving the old
    // `domainVerified: true` standing would let --check report a launch
    // as ready on a stamp that a live DNS answer just contradicted —
    // the readiness table would be asserting something known false.
    // "Unknown" is deliberately NOT enough to clear it: a missing account
    // token says nothing about the domain.
    if (!args['no-write'] && db && domain === configuredDomain && isDefinitiveFailure(status)) {
      await stampVerification({ db, verified: false, method: 'provider-check', domain });
      console.log('\nCleared the stored sender verification: this domain is failing now.');
    }
    return 1;
  }

  if (args['no-write'] || !db || domain !== configuredDomain) {
    console.log('\nVerified. (config/event not stamped: --no-write, no database handle, or a different domain.)');
    return 0;
  }
  const verifiedAt = await stampVerification({ db, verified: true, method: 'provider-check', domain });
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

module.exports = {
  main,
  run,
  internals: { formatStatus, remediation, isDefinitiveFailure, stampVerification, usage, FLAGS },
};
