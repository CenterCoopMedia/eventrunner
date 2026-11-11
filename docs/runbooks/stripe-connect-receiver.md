# Migrate NC Local to the shared Stripe Connect receiver

This is an operator migration for issue #835. It has not been run. Execute it only
under a named coordinator deployment task, after NC Local's site has been built
and confirmed. Keep new live account connections and builds closed until step 6.
Do not run the normal Console deploy first: it removes the one-site guard.

All command blocks use an authenticated Linux operator terminal at the repository
root, on the reviewed release commit, with Node 22, installed dependencies,
Firebase CLI and Google application-default credentials from the deployment
runbook. Use an operator identity authorized for the Console and NC Local projects
and Stripe endpoint management. Secret values stay in process memory and Secret
Manager; never print an API response, signing secret, access token or payment body.
Record only commit, endpoint IDs, secret version IDs, HTTP status and event IDs.

## 1. Confirm identities and retain rollback information

Read the actual private application, connection and build records. Confirm that
the application belongs to NC Local, `console_connections` holds its live Stripe
account, and the build's project and region identify the confirmed site. Record
the existing platform endpoint ID and its exact NC Local `ticketingWebhook` URL.
Retain the current deployed Console commit and the site's existing secret version.
Confirm the site's deployed `ticketingWebhook` binds that same latest
`TICKETING_WEBHOOK_SECRET` version before step 3, which reads latest. If it does
not, reconcile the deployed version under the coordinator's task first. Never
rotate the site's signing secret during this migration.

Set these identifiers in this same operator terminal; none is a credential:

```sh
set -e
export CONSOLE_PROJECT_ID='<console project id>'
export CONSOLE_PROJECT_NUMBER='<console project number>'
export CLIENT_PROJECT_ID='<NC Local project id>'
export CLIENT_REGION='<NC Local function region>'
export APPLICATION_ID='<NC Local application id>'
export STRIPE_ACCOUNT_ID='<connected account id from the private record>'
export OLD_ENDPOINT_ID='<existing platform endpoint id>'
export PROVISIONER='eventrunner-provisioner@<console project id>.iam.gserviceaccount.com'
export CONSOLE_RUNTIME='<Console function runtime service account>'
```

## 2. Grant the new secret prefix only

Keep the existing `connection-` permissions. The provisioner also needs to manage
`stripe-webhook-` secrets; the receiver needs to read them. These conditions use
the Console **project number**, not its project ID:

```sh
gcloud projects add-iam-policy-binding "$CONSOLE_PROJECT_ID" --member="serviceAccount:$PROVISIONER" --role=roles/secretmanager.admin --condition="title=stripe site signing secrets,expression=resource.name.startsWith('projects/$CONSOLE_PROJECT_NUMBER/secrets/stripe-webhook-')"
gcloud projects add-iam-policy-binding "$CONSOLE_PROJECT_ID" --member="serviceAccount:$CONSOLE_RUNTIME" --role=roles/secretmanager.secretAccessor --condition="title=stripe site signing reads,expression=resource.name.startsWith('projects/$CONSOLE_PROJECT_NUMBER/secrets/stripe-webhook-')"
```

Do not grant the receiver permission to read another project's secrets or to
manage Stripe endpoints. Its platform endpoint signing secret is bound by Firebase
only to `stripeConnectWebhook`.

## 3. Register NC Local's route with its existing site secret

This block validates the supplied identifiers against the private Console records,
reads the site's deployed signing secret directly into memory and calls the same
route-registration method as provisioning. Repeating it keeps the same route.

```sh
node -e '
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createSecretStore } = require("./console/functions/src/secretStore.cjs");
const { registerStripeRoute } = require("./console/functions/src/stripeWebhooks.cjs");
(async () => {
  const e = process.env, credential = applicationDefault();
  const db = getFirestore(initializeApp({ projectId: e.CONSOLE_PROJECT_ID, credential }));
  const store = projectId => createSecretStore({ projectId, getAccessToken: () => credential.getAccessToken(), fetch });
  const recordRef = db.doc(`console_builds/${e.APPLICATION_ID}`);
  const build = (await recordRef.get()).data();
  const accounts = (await db.doc(`console_connections/${e.APPLICATION_ID}`).get()).data();
  if (build?.resources?.projectId !== e.CLIENT_PROJECT_ID || build.resources.region !== e.CLIENT_REGION || accounts?.stripe?.accountId !== e.STRIPE_ACCOUNT_ID) throw new Error();
  const secret = await store(e.CLIENT_PROJECT_ID).readSecret("TICKETING_WEBHOOK_SECRET");
  if (!secret) throw new Error();
  await registerStripeRoute({ db, secrets: store(e.CONSOLE_PROJECT_ID), recordRef, appId: e.APPLICATION_ID, accountId: e.STRIPE_ACCOUNT_ID, projectId: e.CLIENT_PROJECT_ID, region: e.CLIENT_REGION, secret });
  console.log("NC Local route registered; signing value not displayed");
})().catch(() => { console.error("Route registration failed; inspect identities and permissions without printing secrets"); process.exitCode = 1; });
'
```

## 4. Create the single platform endpoint, then deploy only the receiver

The following block reads the platform API key at use time, creates the Connect
endpoint and writes its returned secret straight into Console Secret Manager.
It refuses an existing receiver URL rather than creating a duplicate. If the
create or secret write returns an uncertain result, inspect the endpoint ID and
secret version metadata before any retry. Do not print or recover a value through
terminal output. An unusable endpoint needs an explicitly authorized removal
before repeating this block.

```sh
node -e '
const { applicationDefault } = require("firebase-admin/app");
const { createSecretStore } = require("./console/functions/src/secretStore.cjs");
const { STRIPE_WEBHOOK_SECRET } = require("./console/functions/src/stripeWebhooks.cjs");
const { internals: { WEBHOOK_EVENTS } } = require("./functions/src/ticketing/providers/stripe.cjs");
const Stripe = require("stripe");
(async () => {
  const credential = applicationDefault(), projectId = process.env.CONSOLE_PROJECT_ID;
  const secrets = createSecretStore({ projectId, getAccessToken: () => credential.getAccessToken(), fetch });
  const stripe = new Stripe(await secrets.readSecret("CONSOLE_STRIPE_SECRET_KEY"));
  const url = `https://us-central1-${projectId}.cloudfunctions.net/stripeConnectWebhook`;
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) if (endpoint.url === url) throw new Error();
  if (await secrets.versionStamp(STRIPE_WEBHOOK_SECRET)) throw new Error();
  const endpoint = await stripe.webhookEndpoints.create({ url, connect: true, enabled_events: WEBHOOK_EVENTS });
  console.log(`Created shared endpoint ${endpoint.id}`);
  if (!endpoint.secret) throw new Error();
  await secrets.writeSecret(STRIPE_WEBHOOK_SECRET, endpoint.secret);
  console.log("Shared signing secret saved without displaying its value");
})().catch(() => { console.error("Endpoint setup stopped; inspect metadata before retrying"); process.exitCode = 1; });
'
gcloud secrets add-iam-policy-binding CONSOLE_STRIPE_WEBHOOK_SECRET --project="$CONSOLE_PROJECT_ID" --member="serviceAccount:$PROVISIONER" --role=roles/secretmanager.viewer
npx firebase deploy --config console/firebase.json --project "$CONSOLE_PROJECT_ID" --only functions:console:stripeConnectWebhook --non-interactive
```

Stop on any failed command. Do not deploy the other Console functions yet.

## 5. Verify shared delivery, then delete the old endpoint

In Stripe Workbench, resend an existing NC Local event to the **shared** endpoint.
Confirm a 2xx delivery and that NC Local's existing delivery record acknowledges
the same event ID without a duplicate order or reconciliation job. Do not create
a charge. The hosted two-account contract must already pass for this commit.
Confirm that the shared endpoint is the only new endpoint, and that every active
connected account has its own reviewed route before allowing additional accounts.

Only after that proof, delete the recorded old NC Local endpoint with platform
credentials. This block checks its exact URL before deletion and confirms 404;
it cannot delete the shared receiver URL:

```sh
node -e '
const { applicationDefault } = require("firebase-admin/app");
const { createSecretStore } = require("./console/functions/src/secretStore.cjs");
const Stripe = require("stripe");
(async () => {
  const e = process.env, credential = applicationDefault();
  const secrets = createSecretStore({ projectId: e.CONSOLE_PROJECT_ID, getAccessToken: () => credential.getAccessToken(), fetch });
  const stripe = new Stripe(await secrets.readSecret("CONSOLE_STRIPE_SECRET_KEY"));
  const endpoint = await stripe.webhookEndpoints.retrieve(e.OLD_ENDPOINT_ID);
  if (endpoint.url !== `https://${e.CLIENT_REGION}-${e.CLIENT_PROJECT_ID}.cloudfunctions.net/ticketingWebhook`) throw new Error();
  await stripe.webhookEndpoints.del(endpoint.id);
  let absent = false;
  try { await stripe.webhookEndpoints.retrieve(endpoint.id); } catch (err) { if (err.statusCode === 404) absent = true; else throw err; }
  if (!absent) throw new Error();
  console.log(`Old endpoint ${endpoint.id} confirmed absent`);
})().catch(() => { console.error("Old endpoint cleanup failed; keep new live connections closed"); process.exitCode = 1; });
'
```

Resend that event to the shared endpoint again and confirm NC Local still responds
successfully. Record endpoint IDs, commit, delivery status and event ID in the
coordinator's deployment receipt; keep payment payloads and secrets out of it.

## 6. Activate provisioning and remove the migration restriction

Now run the normal reviewed Console deployment and activate the reviewed
provisioner commit. Live builds create routes; they never create site endpoints.
Normal shared-site decommissioning removes its route and secret copy. Retain the
platform API key only for its existing OAuth and operator maintenance purposes;
the live builder does not read it for webhook management.

This completes the one-time migration: remove the temporary restriction on live
connections/builds after the coordinator verifies the old endpoint's absence.
Do not keep an old-endpoint forwarding path. Retain this runbook as the release's
migration record; it is not a recurring setup step.

If shared delivery fails before old-endpoint deletion, keep the existing endpoint
and the deployed one-site guard, repair the receiver and retry. After deletion,
repair shared delivery and use Stripe's event redelivery; do not restore a per-site
platform endpoint or admit another account through it.

References: [ADR 0004](../adr/0004-stripe-ticket-commerce.md),
[signature timestamps and retries](https://docs.stripe.com/webhooks).
