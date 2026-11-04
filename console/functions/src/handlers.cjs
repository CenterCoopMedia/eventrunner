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
 *   CONSOLE_STRIPE_SECRET_KEY          secret: CCM's Stripe key, for the event fee and the Connect platform
 *   CONSOLE_STRIPE_FEE_WEBHOOK_SECRET  secret: signs consoleFeeWebhook deliveries
 *   CONSOLE_EVENTBRITE_CLIENT_SECRET   secret: the Eventbrite app's client secret
 *   CONSOLE_GITHUB_APP_ID              the console's GitHub App, which starts the build
 *   CONSOLE_GITHUB_INSTALLATION_ID     that App's installation on the repository
 *   CONSOLE_GITHUB_REPOSITORY          the repository, as owner/name
 *   CONSOLE_GITHUB_APP_PRIVATE_KEY     secret: that App's private key
 */

const { applyCors, parseAllowedOrigins, postEndpoint } = require('./http.cjs');
const { createOrganization, getTeam, listOrganizations } = require('./organizations.cjs');
const { acceptInvite, inviteMember } = require('./invites.cjs');
const { changeMemberRole, removeMember } = require('./members.cjs');
const { createApplication, getApplication, listApplications } = require('./applications.cjs');
const { saveApplicationStep } = require('./applicationSave.cjs');
const { submitApplication, withdrawApplication } = require('./applicationStatus.cjs');
const { checkWebAddress } = require('./siteNames.cjs');
const { getApplicationForReview, listApplicationsForReview } = require('./reviewQueue.cjs');
const { approveApplication, declineApplication, requestChanges } = require('./reviewDecisions.cjs');
const { deleteSpamApplication, runRetention } = require('./cleanup.cjs');
const { getConsoleSettings, saveAgreement, saveConsoleSettings, saveEventFee } = require('./consoleSettings.cjs');
const { acceptAgreement, getAgreement, reopenApplication } = require('./agreementAcceptance.cjs');
const { startFeeCheckout, stripeClient } = require('./feeCheckout.cjs');
const { feeWebhookEndpoint } = require('./feeWebhook.cjs');
const { createStartBuild } = require('./buildDispatch.cjs');
const { retryBuild } = require('./buildRetry.cjs');
const {
  chooseEventbriteEvent, completeConnection, disconnectAccount, listEventbriteEvents, startConnection,
} = require('./connections.cjs');
const { connectionsAvailable, createConnectors } = require('./connectors.cjs');

// Fixed, not a setting: console/firebase.json routes every /api/<name> to
// this region, and the web app calls only those routes. Moving the console
// means changing both files together.
const REGION = 'us-central1';
// Daily, at a quiet hour. The job is safe to run again at any time.
const RETENTION_SCHEDULE = 'every day 04:17';

const ENDPOINTS = Object.freeze({
  listOrganizations: { action: listOrganizations },
  createOrganization: { action: createOrganization },
  getTeam: { action: getTeam },
  inviteMember: { action: inviteMember, mail: true },
  acceptInvite: { action: acceptInvite },
  changeMemberRole: { action: changeMemberRole },
  removeMember: { action: removeMember },
  createApplication: { action: createApplication },
  getApplication: { action: getApplication },
  listApplications: { action: listApplications },
  saveApplicationStep: { action: saveApplicationStep },
  checkWebAddress: { action: checkWebAddress },
  submitApplication: { action: submitApplication, mail: true },
  withdrawApplication: { action: withdrawApplication, mail: true, stripe: true },
  // The agreement and the event fee (ADR 0007, amendment 2026-11-04).
  getAgreement: { action: getAgreement },
  acceptAgreement: { action: acceptAgreement, mail: true },
  reopenApplication: { action: reopenApplication, mail: true, stripe: true },
  startFeeCheckout: { action: startFeeCheckout, stripe: true },
  // Operator review (ADR 0007 §5).
  listApplicationsForReview: { action: listApplicationsForReview },
  getApplicationForReview: { action: getApplicationForReview },
  requestChanges: { action: requestChanges, mail: true },
  declineApplication: { action: declineApplication, mail: true, stripe: true },
  approveApplication: { action: approveApplication, mail: true },
  retryBuild: { action: retryBuild, mail: true, build: true },
  deleteSpamApplication: { action: deleteSpamApplication, stripe: true, connect: true },
  getConsoleSettings: { action: getConsoleSettings },
  saveConsoleSettings: { action: saveConsoleSettings },
  saveEventFee: { action: saveEventFee },
  saveAgreement: { action: saveAgreement },
  // Account connections (ADR 0007 §4).
  startConnection: { action: startConnection, connect: true },
  completeConnection: { action: completeConnection, connect: true },
  disconnectAccount: { action: disconnectAccount, connect: true },
  listEventbriteEvents: { action: listEventbriteEvents, connect: true },
  chooseEventbriteEvent: { action: chooseEventbriteEvent, connect: true },
});

/** Called by a provider: the raw body, a signature, and no sign-in or CORS. */
const WEBHOOKS = Object.freeze({
  consoleFeeWebhook: { endpoint: feeWebhookEndpoint },
});

/** Scheduled jobs: not HTTP, so no Hosting rewrite. */
const SCHEDULED = Object.freeze({
  runApplicationRetention: { job: runRetention, schedule: RETENTION_SCHEDULE, connect: true },
});

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
  const feeWebhookSecret = defineSecret('CONSOLE_STRIPE_FEE_WEBHOOK_SECRET');
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
  for (const [name, spec] of Object.entries(ENDPOINTS)) {
    const secrets = [...new Set([
      ...(spec.mail ? [postmarkToken] : []),
      ...(spec.stripe ? [stripeKey] : []),
      ...(spec.connect ? connectSecrets : []),
      ...(spec.build ? [githubAppKey] : []),
    ])];
    const options = { region, ...(secrets.length > 0 ? { secrets } : {}) };
    handlers[name] = onRequest(options, async (req, res) => {
      if (applyCors(req, res, parseAllowedOrigins(process.env.CONSOLE_ALLOWED_ORIGINS))) return;
      const { db, auth } = adminServices();
      const deps = { db, auth, now: Date.now, log: console, publicUrl: publicUrl(), connectionsAvailable: connectionsAvailable(process.env) };
      if (spec.connect) Object.assign(deps, connectDeps());
      if (spec.mail) deps.mailer = lazyMailer();
      if (spec.stripe) deps.stripe = stripeClient(stripeKey.value());
      if (spec.build) deps.startBuild = buildStarter();
      await postEndpoint(deps, (input) => spec.action(deps, input))(req, res);
    });
  }
  for (const [name, spec] of Object.entries(WEBHOOKS)) {
    handlers[name] = onRequest({ region, secrets: [postmarkToken, stripeKey, feeWebhookSecret, githubAppKey] }, async (req, res) => {
      const { db } = adminServices();
      await spec.endpoint({
        db,
        now: Date.now,
        log: console,
        publicUrl: publicUrl(),
        mailer: lazyMailer(),
        stripe: stripeClient(stripeKey.value()),
        webhookSecret: feeWebhookSecret.value(),
        startBuild: buildStarter(),
      })(req, res);
    });
  }
  for (const [name, spec] of Object.entries(SCHEDULED)) {
    const secrets = spec.connect ? { secrets: connectSecrets } : {};
    handlers[name] = onSchedule({ region, schedule: spec.schedule, timeZone: 'America/New_York', ...secrets }, async () => {
      const { db } = adminServices();
      await spec.job({ db, now: Date.now, log: console, ...(spec.connect ? connectDeps() : {}) });
    });
  }
  return handlers;
}

module.exports = { ENDPOINTS, REGION, SCHEDULED, WEBHOOKS, buildHandlers };
