'use strict';

/**
 * Add a client's custom web address. Operator tooling: the admin page only
 * shows the status, and the `webAddress` function refuses to add a domain.
 *
 *   EVENT_FIREBASE_PROJECT_ID=<id> node scripts/add-web-address.cjs <domain> [--dry-run]
 *
 * Asks Firebase Hosting for the domain, stores `web_address/current`, and
 * prints the DNS records for the client. It does not touch sign-in: the
 * status check adds the domain to the authorized domains once Hosting serves
 * it. Run it with the client project's operator credentials, the same as
 * scripts/remove-web-address.cjs; they need roles/firebasehosting.admin,
 * roles/datastore.user and roles/serviceusage.serviceUsageConsumer.
 * `EVENT_HOSTING_SITE` names the site when it is not the project id.
 *
 * Exit codes: 0 added, already stored, or a dry run; 1 refused or failed.
 */

const { parseArgv, unknownFlags } = require('./lib/args.cjs');
const { addWebAddress, createHostingClient } = require('../functions/src/admin/webAddress.cjs');

function recordLines(records) {
  return records.map((record) => `  ${record.action === 'remove' ? 'Remove' : 'Add'}  ${record.type}  ${record.host}  ${record.value}`);
}

/** What the operator does next, true to what the code does. */
function nextSteps(domain, records) {
  return [
    records.length
      ? 'Give the client these DNS records. Lines marked Remove are records that conflict with Hosting:'
      : 'Hosting is still preparing the DNS records. Settings → Web address shows them after Check now or the hourly check.',
    ...recordLines(records),
    '',
    'The hourly check and Check now on Settings → Web address move the status. It shows Waiting for the records',
    'until Hosting serves the domain with a certificate (minutes to about a day after the records are in).',
    `The first check that finds it served adds ${domain} to the sign-in authorized domains. Then it shows Ready to switch.`,
    `Then set EVENT_PUBLIC_URL to https://${domain}, add it to EVENT_ALLOWED_ORIGINS, and deploy (docs/DEPLOY_RUNBOOK.md).`,
    `To take the domain away again, run: node scripts/remove-web-address.cjs ${domain}`,
  ];
}

/** Parse, add, print. Returns the exit code; every Google and Firestore call is injected. */
async function run({ argv, env, clients, log = console.log, error = console.error }) {
  const args = parseArgv(argv);
  const unknown = unknownFlags(args, ['dry-run']);
  if (unknown.length || args._.length !== 1 || !(env.EVENT_FIREBASE_PROJECT_ID || '').trim()) {
    error('Usage: EVENT_FIREBASE_PROJECT_ID=<id> node scripts/add-web-address.cjs <domain> [--dry-run]');
    return 1;
  }
  const dryRun = args['dry-run'] === true;
  const { db, hosting } = clients();
  let result;
  try {
    result = await addWebAddress({ db, hosting, domain: args._[0], dryRun });
  } catch (err) {
    error(`Adding the domain did not finish (${err?.message || 'unknown error'}). Nothing is stored yet. Run the same command again.`);
    return 1;
  }
  const { outcome, domain, record } = result;
  if (outcome === 'invalid') {
    error('Give a plain domain such as summit.example.org, with no https:// and no path. *.web.app, *.firebaseapp.com and *.eventrunner.org addresses are not custom domains.');
    return 1;
  }
  if (outcome === 'other-domain') {
    error(`The site already has ${record.domain} stored. Remove it first: node scripts/remove-web-address.cjs ${record.domain}`);
    return 1;
  }
  if (outcome === 'removing') {
    error(`The removal of ${domain} did not finish. Run node scripts/remove-web-address.cjs ${domain} again first.`);
    return 1;
  }
  if (outcome === 'stored') {
    log(`${domain} is already stored (status: ${record.state}). Nothing changed. Settings → Web address shows its status and records.`);
    return 0;
  }
  if (outcome === 'planned') {
    log(`Dry run. Nothing was changed. Without --dry-run this would:`);
    log(`  ask Firebase Hosting for ${domain} on site ${(env.EVENT_HOSTING_SITE || '').trim() || env.EVENT_FIREBASE_PROJECT_ID.trim()},`);
    log('  store web_address/current with the status Waiting for the records,');
    log('  and print the DNS records for the client.');
    return 0;
  }
  log(`Added ${domain}.`);
  for (const line of nextSteps(domain, record.records)) log(line);
  return 0;
}

// User credentials need the project named for quota on these APIs (DEPLOY_RUNBOOK §12.3).
function withUserProject(projectId, fetchImpl = globalThis.fetch) {
  return (url, init = {}) => fetchImpl(url, { ...init, headers: { ...init.headers, 'x-goog-user-project': projectId } });
}

/** The real clients, with the client project's operator credentials. */
function realClients(env) {
  const { applicationDefault, initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const projectId = env.EVENT_FIREBASE_PROJECT_ID.trim();
  const credential = applicationDefault();
  initializeApp({ projectId, credential });
  const getAccessToken = async () => (await credential.getAccessToken()).access_token;
  const fetchImpl = withUserProject(projectId);
  return {
    db: getFirestore(),
    hosting: createHostingClient({ projectId, site: (env.EVENT_HOSTING_SITE || '').trim() || projectId, fetchImpl, getAccessToken }),
  };
}

if (require.main === module) {
  run({ argv: process.argv.slice(2), env: process.env, clients: () => realClients(process.env) })
    .then((code) => { process.exitCode = code; });
}

module.exports = { run, nextSteps, withUserProject };
