#!/usr/bin/env node
'use strict';

/**
 * Ticketing webhook registration (spec §3.3, §5.6 item 5; issue #30).
 *
 * Wraps the configured TicketingProvider's `registerWebhook()` as an
 * operator command, the same shape `verify-sender-domain.cjs` (§5.6 item 4)
 * uses for its own provisioning step: a checklist item that has to be run
 * once per deployment, from a terminal with real credentials, well before
 * the first Eventbrite order ever needs to reach this project.
 *
 * CAPABILITY, NOT ENABLEMENT (§3.3). Webhook registration applies only to
 * providers that implement `registerWebhook` — today that is `eventbrite`
 * alone. `manual` has no webhook to register and `none` has no provider at
 * all, so this script exits 0 with an explanatory message for either,
 * rather than failing a checklist item a CSV deployment could never
 * satisfy. The gate is `typeof provider.registerWebhook !== 'function'`,
 * never a name comparison — the same test `getTicketingStatus` and
 * `scripts/lib/readiness.cjs` use.
 *
 * On success, `config/providers.ticketing.webhookRegisteredAt` and
 * `.webhookId` are stamped — this script is the SANCTIONED writer of that
 * pair, the ticketing analog of `verify-sender-domain.cjs` stamping
 * `config/event.sender.domainVerified`. `admin/config.cjs` never accepts
 * `providers.*` from the panel (spec §1.3 item 3), so there is exactly one
 * writer, and `readTicketingStatus` / `scripts/lib/readiness.cjs`'s
 * ticketing row are the two readers.
 *
 * The callback URL defaults to the deployed `ticketingWebhook` function's
 * URL, built from `EVENT_FIREBASE_PROJECT_ID` / `EVENT_FIREBASE_REGION`
 * (Tier A, spec §2.1) — the same "region-project.cloudfunctions.net/name"
 * shape the ADR's own email-webhook example (§3.1) uses. `--callback-url`
 * overrides it, for a project whose functions live behind a different
 * front door (a custom domain rewrite, a non-default Hosting mapping).
 *
 * Exit codes: 0 registered (or not applicable), 1 registration failed,
 * 2 misconfigured.
 *
 * Usage:
 *   EVENT_TICKETING_PROVIDER=eventbrite EVENT_TICKETING_EVENT_ID=… \
 *   TICKETING_API_TOKEN=… TICKETING_WEBHOOK_SECRET=… \
 *   EVENT_FIREBASE_PROJECT_ID=… node scripts/register-ticketing-webhook.cjs
 *
 *   node scripts/register-ticketing-webhook.cjs --callback-url https://example.org/ticketingWebhook --no-write
 */

const { parseArgv, unknownFlags } = require('./lib/args.cjs');

const FLAGS = ['callback-url', 'no-write', 'help'];

/** Webhook events every registration asks for — mirrors webhook.cjs's ACTIONABLE_EVENT_TYPES (§3.3). */
const WEBHOOK_EVENTS = ['order.placed', 'order.updated', 'attendee.updated'];

/**
 * The deployed `ticketingWebhook` function's default URL, same shape as
 * the ADR's `emailDeliveryWebhook` example (spec §3.1).
 * @param {{ projectId: string, region: string }} args
 */
function defaultCallbackUrl({ projectId, region }) {
  return `https://${region}-${projectId}.cloudfunctions.net/ticketingWebhook`;
}

/**
 * Stamp `config/providers.ticketing.{webhookRegisteredAt,webhookId}`. Only
 * these two fields — Firestore's `set(..., {merge:true})` merges at the
 * field-path level, so `providers.ticketing.provider` and
 * `.externalEventId` (Tier-A mirrors, never written here) are untouched,
 * same discipline `verify-sender-domain.cjs`'s `stampVerification` uses.
 *
 * @param {{ db: object, webhookId: string, now?: () => number }} args
 * @returns {Promise<string>} the ISO stamp written
 */
async function stampWebhookRegistration({ db, webhookId, now = Date.now }) {
  const at = new Date(now()).toISOString();
  await db.collection('config').doc('providers').set(
    { ticketing: { webhookRegisteredAt: at, webhookId } },
    { merge: true },
  );
  return at;
}

function usage() {
  return [
    'Usage: node scripts/register-ticketing-webhook.cjs [--callback-url <url>] [--no-write]',
    '',
    '  --callback-url <url>  register this URL instead of the default',
    '                         https://<region>-<project>.cloudfunctions.net/ticketingWebhook',
    '  --no-write             report only; do not stamp config/providers.ticketing',
    '',
    'Environment (Tier A, .env.example):',
    '  EVENT_TICKETING_PROVIDER    eventbrite | manual | none',
    '  EVENT_TICKETING_EVENT_ID    required when provider is eventbrite',
    '  TICKETING_API_TOKEN         required when provider is not none',
    '  TICKETING_WEBHOOK_SECRET    required for a registerWebhook-capable provider (eventbrite today)',
    '  EVENT_FIREBASE_PROJECT_ID   the project whose config/providers is read and stamped',
    '  EVENT_FIREBASE_REGION       default us-central1',
  ].join('\n');
}

async function run({ args, env = process.env, deps = {} }) {
  const { getTicketingProvider } = deps.getTicketingProvider
    ? deps
    : require('../functions/src/ticketing/providers/index.cjs');

  let provider;
  try {
    provider = getTicketingProvider({ env });
  } catch (err) {
    console.error(`Ticketing provider not configured: ${err.message}`);
    return 2;
  }

  if (typeof provider.registerWebhook !== 'function') {
    // Capability, not enablement (§3.3) — manual and none both land here,
    // and both exit 0: a checklist item neither could ever satisfy must
    // not block launch readiness.
    console.log(
      `Provider "${provider.name}" does not support webhook registration — nothing to register ` +
      '(spec §3.3: registerWebhook is a capability, not every provider implements it).',
    );
    return 0;
  }

  const projectId = (env.EVENT_FIREBASE_PROJECT_ID || '').trim();
  const region = (env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const callbackUrl = (typeof args['callback-url'] === 'string' && args['callback-url'].trim())
    || (projectId ? defaultCallbackUrl({ projectId, region }) : '');
  if (!callbackUrl) {
    console.error(
      'No callback URL: pass --callback-url, or set EVENT_FIREBASE_PROJECT_ID so the default ' +
      '(https://<region>-<project>.cloudfunctions.net/ticketingWebhook) can be built.',
    );
    return 2;
  }

  console.log(`\nRegistering the ${provider.name} webhook (spec §3.3)\n`);
  console.log(`  Callback URL: ${callbackUrl}`);
  console.log(`  Events:       ${WEBHOOK_EVENTS.join(', ')}`);

  let result;
  try {
    result = await provider.registerWebhook({ callbackUrl, events: WEBHOOK_EVENTS });
  } catch (err) {
    console.error(`\nRegistration failed: ${err.message}`);
    return 1;
  }
  if (!result || typeof result.webhookId !== 'string' || !result.webhookId) {
    console.error('\nRegistration failed: the provider returned no webhookId.');
    return 1;
  }
  console.log(`\nRegistered. webhookId = ${result.webhookId}`);

  if (args['no-write']) {
    console.log('--no-write: config/providers.ticketing not stamped.');
    return 0;
  }

  const initFirebase = deps.initFirebase || require('./lib/firebase-init.cjs').initFirebase;
  let db;
  try {
    ({ db } = initFirebase({ env }));
  } catch (err) {
    console.error(
      `\nRegistered with the provider, but could not connect to Firestore to stamp the result: ${err.message}\n` +
      `Record it by hand: config/providers.ticketing = { webhookRegisteredAt: <now>, webhookId: "${result.webhookId}" }.`,
    );
    return 1;
  }
  const stampedAt = await stampWebhookRegistration({ db, webhookId: result.webhookId });
  console.log(
    `Stamped config/providers.ticketing.webhookRegisteredAt = ${stampedAt}, .webhookId = ${result.webhookId}.`,
  );
  console.log('\nConfirm the delivery in the admin panel (Ticketing tab) or via getTicketingStatus.');
  return 0;
}

async function main(argv) {
  const args = parseArgv(argv, { withValue: ['callback-url'] });
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
      console.error(`register-ticketing-webhook: ${err.stack || err.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  main,
  run,
  internals: { defaultCallbackUrl, stampWebhookRegistration, usage, FLAGS, WEBHOOK_EVENTS },
};
