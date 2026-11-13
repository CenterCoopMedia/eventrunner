'use strict';

/**
 * Deploy wiring: each console action becomes one HTTP function. The web
 * app calls them at `/api/<name>` through the Hosting rewrites in
 * console/firebase.json. Nothing here runs in the unit tests except the
 * shape check in handlers.test.cjs; the actions take every dependency as
 * an argument.
 *
 * Settings (console project only, never a client project):
 *   CONSOLE_PUBLIC_URL       the console address, for invite links
 *   CONSOLE_MAIL_FROM        the sender of invite emails
 *   CONSOLE_ALLOWED_ORIGINS  extra origins for a local dev server
 *   CONSOLE_POSTMARK_TOKEN   secret: the Postmark server token
 *   CONSOLE_STRIPE_CLIENT_ID           the Stripe Connect client id; unset means not available yet
 *   CONSOLE_EVENTBRITE_CLIENT_ID       the Eventbrite app key; unset means not available yet
 *   CONSOLE_STRIPE_SECRET_KEY          secret: CCM's Stripe key, for the Connect platform
 *   CONSOLE_STRIPE_WEBHOOK_SECRET      secret: signing secret of the shared live Connect endpoint
 *   CONSOLE_EVENTBRITE_CLIENT_SECRET   secret: the Eventbrite app's client secret
 *   CONSOLE_GITHUB_APP_ID              the console's GitHub App, which starts the build
 *   CONSOLE_GITHUB_INSTALLATION_ID     that App's installation on the repository
 *   CONSOLE_GITHUB_REPOSITORY          the repository, as owner/name
 *   CONSOLE_GITHUB_APP_PRIVATE_KEY     secret: that App's private key
 *   CONSOLE_TEST_MODE                  'true' on a rehearsal console: its builds run in test mode, so a test-mode account passes
 *   CONSOLE_REPORT_INTAKE_URL          where "Report a problem" sends reports (the operator's triage service)
 *   CONSOLE_REPORT_PROJECTS            extra client projects whose admins may report, for sites from before the console
 *   CONSOLE_REPORT_INTAKE_SECRET       secret: the triage service's intake key
 *   CONSOLE_REPORT_ACCESS_ID           secret: the access-gate service token id for that intake path
 *   CONSOLE_REPORT_ACCESS_SECRET       secret: that service token's secret
 */

const { applyCors, parseAllowedOrigins, postEndpoint } = require('./http.cjs');
const { getTeam, listOrganizations } = require('./organizations.cjs');
const { deleteOrganization } = require('./organizationDelete.cjs');
const { acceptInvite, inviteMember } = require('./invites.cjs');
const { changeMemberRole, removeMember } = require('./members.cjs');
const { getApplication, listApplications } = require('./applications.cjs');
const { saveApplicationStep } = require('./applicationSave.cjs');
const { withdrawApplication } = require('./applicationStatus.cjs');
const { checkWebAddress } = require('./siteNames.cjs');
const { getApplicationForReview, listApplicationsForReview } = require('./reviewQueue.cjs');
const { closeApplication, declineApplication, launchApplication } = require('./reviewDecisions.cjs');
const { deleteSpamApplication, runRetention } = require('./cleanup.cjs');
const { getConsoleSettings, saveAgreement, saveConsoleSettings } = require('./consoleSettings.cjs');
const { acceptAgreement, getAgreement } = require('./agreementAcceptance.cjs');
const {
  createSignupLink, getSignupLink, listSignupLinks, redeemSignupLink, revokeSignupLink,
} = require('./signupLinks.cjs');
const { createStartBuild } = require('./buildDispatch.cjs');
const { reportSilentBuilds, retryBuild } = require('./buildRetry.cjs');
const {
  chooseEventbriteEvent, completeConnection, disconnectAccount, listEventbriteEvents, startConnection,
} = require('./connections.cjs');
const { connectionsAvailable, createConnectors } = require('./connectors.cjs');
const { reportOriginAllowed, reportProblemHandler } = require('./problemReports.cjs');
const { STRIPE_WEBHOOK_FUNCTION, STRIPE_WEBHOOK_SECRET, stripeConnectWebhook } = require('./stripeWebhooks.cjs');

// Fixed, not a setting: console/firebase.json routes every /api/<name> to
// this region, and the web app calls only those routes. Moving the console
// means changing both files together.
const REGION = 'us-central1';
// Daily, at a quiet hour. The job is safe to run again at any time.
const RETENTION_SCHEDULE = 'every day 04:17';
const BUILD_WATCH_SCHEDULE = 'every 60 minutes';

const ENDPOINTS = Object.freeze({
  listOrganizations: { action: listOrganizations },
  deleteOrganization: { action: deleteOrganization, connect: true },
  getTeam: { action: getTeam },
  inviteMember: { action: inviteMember, mail: true },
  acceptInvite: { action: acceptInvite },
  changeMemberRole: { action: changeMemberRole },
  removeMember: { action: removeMember },
  getApplication: { action: getApplication },
  listApplications: { action: listApplications },
  saveApplicationStep: { action: saveApplicationStep },
  checkWebAddress: { action: checkWebAddress },
  withdrawApplication: { action: withdrawApplication, mail: true },
  // Signup links and the agreement (ADR 0007, amendment 2026-11-04).
  createSignupLink: { action: createSignupLink },
  listSignupLinks: { action: listSignupLinks },
  revokeSignupLink: { action: revokeSignupLink },
  getSignupLink: { action: getSignupLink },
  redeemSignupLink: { action: redeemSignupLink },
  getAgreement: { action: getAgreement },
  acceptAgreement: { action: acceptAgreement, mail: true, build: true },
  // Operator review (ADR 0007 §5). An Owner can also retry a failed build.
  listApplicationsForReview: { action: listApplicationsForReview },
  getApplicationForReview: { action: getApplicationForReview },
  declineApplication: { action: declineApplication, mail: true },
  closeApplication: { action: closeApplication, mail: true, connect: true },
  launchApplication: { action: launchApplication, mail: true },
  retryBuild: { action: retryBuild, mail: true, build: true },
  deleteSpamApplication: { action: deleteSpamApplication, connect: true },
  getConsoleSettings: { action: getConsoleSettings },
  saveConsoleSettings: { action: saveConsoleSettings },
  saveAgreement: { action: saveAgreement },
  // Account connections (ADR 0007 §4).
  startConnection: { action: startConnection, connect: true },
  completeConnection: { action: completeConnection, connect: true },
  disconnectAccount: { action: disconnectAccount, connect: true },
  listEventbriteEvents: { action: listEventbriteEvents, connect: true },
  chooseEventbriteEvent: { action: chooseEventbriteEvent, connect: true },
});

/** Scheduled jobs: not HTTP, so no Hosting rewrite. */
const SCHEDULED = Object.freeze({
  runApplicationRetention: { job: runRetention, schedule: RETENTION_SCHEDULE, connect: true },
  runBuildWatch: { job: reportSilentBuilds, schedule: BUILD_WATCH_SCHEDULE, mail: true },
});

// "Report a problem" answers the console and every client site's admin
// panel, so it has its own CORS and sign-in check (problemReports.cjs).
const REPORT_FUNCTION = 'reportProblem';

const MAIL_METHODS = Object.freeze(['sendInvite', 'sendStatusChange', 'sendOperatorNotice', 'sendAgreementCopy']);

let services = null;
function adminServices() {
  if (!services) {
    const { getApps, initializeApp } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const { getAuth } = require('firebase-admin/auth');
    if (getApps().length === 0) initializeApp();
    services = { db: getFirestore(), auth: getAuth() };
  }
  return services;
}

/** `startBuild({ orgId, appId })` defaults to the GitHub dispatch; a test can give its own. */
function buildHandlers({ startBuild } = {}) {
  const { onRequest } = require('firebase-functions/v2/https');
  const { onSchedule } = require('firebase-functions/v2/scheduler');
  const { defineSecret } = require('firebase-functions/params');
  const { createPostmarkMailer } = require('./mailer.cjs');

  const region = REGION;
  const postmarkToken = defineSecret('CONSOLE_POSTMARK_TOKEN');
  const stripeKey = defineSecret('CONSOLE_STRIPE_SECRET_KEY');
  const stripeWebhookSecret = defineSecret(STRIPE_WEBHOOK_SECRET);
  const eventbriteClientSecret = defineSecret('CONSOLE_EVENTBRITE_CLIENT_SECRET');
  const connectSecrets = [stripeKey, eventbriteClientSecret];
  const githubAppKey = defineSecret('CONSOLE_GITHUB_APP_PRIVATE_KEY');

  // Made at send time, so a missing setting is a failed send that the
  // action reports and logs, not a crash before the request is read.
  const lazyMailer = () => {
    const mailer = () => createPostmarkMailer({
      token: postmarkToken.value(),
      from: process.env.CONSOLE_MAIL_FROM || '',
      fetch: globalThis.fetch,
    });
    return Object.fromEntries(MAIL_METHODS.map((method) => [method, (message) => mailer()[method](message)]));
  };
  const buildStarter = () => startBuild || createStartBuild({
    env: process.env,
    privateKey: githubAppKey.value(),
    fetch: globalThis.fetch,
  });
  const publicUrl = () => (process.env.CONSOLE_PUBLIC_URL || '').replace(/\/+$/, '');
  // Made per call: secret values exist only while a function that declares them runs.
  const connectDeps = () => {
    const { applicationDefault } = require('firebase-admin/app');
    const { createSecretStore } = require('./secretStore.cjs');
    return {
      connectors: createConnectors({
        env: process.env,
        stripeSecretKey: stripeKey.value(),
        eventbriteClientSecret: eventbriteClientSecret.value(),
        fetch: globalThis.fetch,
      }),
      secrets: createSecretStore({
        projectId: process.env.GCLOUD_PROJECT,
        getAccessToken: () => applicationDefault().getAccessToken(),
        fetch: globalThis.fetch,
        log: console,
      }),
    };
  };

  const handlers = {};
  handlers[STRIPE_WEBHOOK_FUNCTION] = onRequest({ region, secrets: [stripeWebhookSecret], invoker: 'public' }, async (req, res) => {
    const { applicationDefault } = require('firebase-admin/app');
    const { createSecretStore } = require('./secretStore.cjs');
    await stripeConnectWebhook({
      db: adminServices().db,
      endpointSecret: stripeWebhookSecret.value(),
      secrets: createSecretStore({
        projectId: process.env.GCLOUD_PROJECT,
        getAccessToken: () => applicationDefault().getAccessToken(),
        fetch: globalThis.fetch,
      }),
      fetch: globalThis.fetch,
      log: require('firebase-functions/logger'),
    })(req, res);
  });
  for (const [name, spec] of Object.entries(ENDPOINTS)) {
    const secrets = [...new Set([
      ...(spec.mail ? [postmarkToken] : []),
      ...(spec.connect ? connectSecrets : []),
      ...(spec.build ? [githubAppKey] : []),
    ])];
    const options = { region, ...(secrets.length > 0 ? { secrets } : {}) };
    handlers[name] = onRequest(options, async (req, res) => {
      if (applyCors(req, res, parseAllowedOrigins(process.env.CONSOLE_ALLOWED_ORIGINS))) return;
      const { db, auth } = adminServices();
      const deps = {
        db,
        auth,
        now: Date.now,
        log: console,
        publicUrl: publicUrl(),
        connectionsAvailable: connectionsAvailable(process.env),
        consoleTestMode: process.env.CONSOLE_TEST_MODE === 'true',
      };
      if (spec.connect) Object.assign(deps, connectDeps());
      if (spec.mail) deps.mailer = lazyMailer();
      if (spec.build) deps.startBuild = buildStarter();
      await postEndpoint(deps, (input) => spec.action(deps, input))(req, res);
    });
  }
  const reportSecrets = ['CONSOLE_REPORT_INTAKE_SECRET', 'CONSOLE_REPORT_ACCESS_ID', 'CONSOLE_REPORT_ACCESS_SECRET'].map(defineSecret);
  const clientAuths = new Map();
  // A client project's ID tokens are checked with Google's public keys; no access to the project is needed.
  const authFor = (projectId) => {
    if (!clientAuths.has(projectId)) {
      const { getApps, initializeApp } = require('firebase-admin/app');
      const { getAuth } = require('firebase-admin/auth');
      const name = `report-${projectId}`;
      const app = getApps().find((a) => a.name === name) || initializeApp({ projectId }, name);
      clientAuths.set(projectId, getAuth(app));
    }
    return clientAuths.get(projectId);
  };
  handlers[REPORT_FUNCTION] = onRequest({ region, secrets: reportSecrets }, async (req, res) => {
    const origin = req.headers?.origin;
    const extraOrigins = parseAllowedOrigins(process.env.CONSOLE_ALLOWED_ORIGINS);
    if (reportOriginAllowed(origin, extraOrigins)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Max-Age', '3600');
      res.set('Access-Control-Expose-Headers', 'Retry-After');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    const { db, auth } = adminServices();
    const [secret, accessId, accessSecret] = reportSecrets.map((s) => s.value());
    await reportProblemHandler({
      db,
      auth,
      authFor,
      fetch: globalThis.fetch,
      now: Date.now,
      log: console,
      consoleProject: process.env.GCLOUD_PROJECT,
      extraProjects: parseAllowedOrigins(process.env.CONSOLE_REPORT_PROJECTS),
      extraOrigins,
      intake: { url: process.env.CONSOLE_REPORT_INTAKE_URL || '', secret, accessId, accessSecret },
    })(req, res);
  });
  for (const [name, spec] of Object.entries(SCHEDULED)) {
    const secrets = [...(spec.mail ? [postmarkToken] : []), ...(spec.connect ? connectSecrets : [])];
    handlers[name] = onSchedule({ region, schedule: spec.schedule, timeZone: 'America/New_York', secrets }, async () => {
      const { db } = adminServices();
      await spec.job({
        db,
        now: Date.now,
        log: console,
        ...(spec.connect ? connectDeps() : {}),
        ...(spec.mail ? { mailer: lazyMailer(), publicUrl: publicUrl() } : {}),
      });
    });
  }
  return handlers;
}

module.exports = { ENDPOINTS, REGION, REPORT_FUNCTION, SCHEDULED, buildHandlers };
