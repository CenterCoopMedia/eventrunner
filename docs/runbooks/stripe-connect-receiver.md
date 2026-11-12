# Migrate NC Local to the shared Stripe Connect receiver

This is an operator migration for issue #835. It has not been run. Execute it only
under a named coordinator deployment task, after NC Local's site has been built
and confirmed. Keep new live account connections and builds closed until step 6.
Do not run the normal Console deploy first: it removes the one-site guard.
The build dispatcher always uses `main`, so merging activates the provisioner
immediately. Complete steps 1–5, including the prefix grants and shared signing
secret metadata grant, **before merging** this change. An undeployed Console
does not hold back the provisioner. Keep live builds paused throughout migration.

All command blocks use an authenticated Linux operator terminal at the repository
root, on the reviewed release commit, with Node 22, installed dependencies,
Firebase CLI and the existing authenticated gcloud operator. Google clients use
an OAuth2Client with a short-lived token fetched from gcloud into process memory;
Firestore uses REST. Do not create interactive application-default credentials.
Use an operator identity authorized for the Console and NC Local projects
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
const { execFileSync } = require("node:child_process");
const { Firestore } = require("@google-cloud/firestore");
const { OAuth2Client } = require("google-gax/node_modules/google-auth-library");
const { createSecretStore } = require("./console/functions/src/secretStore.cjs");
const { registerStripeRoute } = require("./console/functions/src/stripeWebhooks.cjs");
(async () => {
  const e = process.env;
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: token });
  const credential = { getAccessToken: async () => ({ access_token: token }) };
  const db = new Firestore({ projectId: e.CONSOLE_PROJECT_ID, authClient, preferRest: true });
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
const { execFileSync } = require("node:child_process");
const { createSecretStore } = require("./console/functions/src/secretStore.cjs");
const { STRIPE_WEBHOOK_SECRET } = require("./console/functions/src/stripeWebhooks.cjs");
const { internals: { WEBHOOK_EVENTS } } = require("./functions/src/ticketing/providers/stripe.cjs");
const Stripe = require("stripe");
(async () => {
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const credential = { getAccessToken: async () => ({ access_token: token }) }, projectId = process.env.CONSOLE_PROJECT_ID;
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
```

Deploy the receiver in a separate block, so a deploy failure never repeats endpoint
creation. The pinned Firebase CLI accepts an access token through `FIREBASE_TOKEN`:
its `auth.refreshTokens` returns the supplied token when the refresh exchange
answers 400 or 401. Keep the value in the child environment only. A read-only
`functions:list` with this method succeeded on November 12 before migration.

```sh
node -e '
const { execFileSync, spawnSync } = require("node:child_process");
const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
const result = spawnSync("npx", ["firebase", "deploy", "--config", "console/firebase.json", "--project", process.env.CONSOLE_PROJECT_ID, "--only", "functions:console:stripeConnectWebhook", "--non-interactive"], {
  env: { ...process.env, FIREBASE_TOKEN: token }, stdio: "inherit",
});
process.exit(result.status ?? 1);
'
```

Stop on any failed command. Do not deploy the other Console functions yet.

## 5. Verify shared delivery, then delete the old endpoint

The November 12 operator has no Stripe Workbench session, and the platform key's
Events read is refused (403). The coordinator approved this no-charge proof
before execution: send a synthetic `account.updated` envelope with NC Local's
account ID and `livemode: true`, signed in memory with the shared endpoint's
secret. This proves signature verification and routing, not Stripe-originated
delivery. The first real Stripe event remains final confirmation.

The site's Stripe provider verifies the per-site signature before acknowledging
an event type outside `WEBHOOK_EVENTS` as `ignored`
(`functions/src/ticketing/providers/stripe.cjs`, `verifyWebhook`). The webhook
handler then returns 200 with `ignored: not_actionable`, before claiming a
delivery or queuing work (`functions/src/ticketing/webhook.cjs`).
`account.updated` is outside that event list. Do not create a charge or use an
actionable event type. The hosted two-account contract must already pass for
this commit.

Run this block before deletion and again after deletion. It requires 400 for
a bad signature, 404 for a correctly signed unknown account, and 200 for NC
Local. The receiver returns 200 only after its destination returns 2xx. The
direct-site check also requires the exact no-op acknowledgement. Signatures,
secret values and payloads are never printed.

```sh
node -e '
const { execFileSync } = require("node:child_process");
const { createHmac } = require("node:crypto");
const { createSecretStore } = require("./console/functions/src/secretStore.cjs");
(async () => {
  const e = process.env;
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const store = projectId => createSecretStore({ projectId, getAccessToken: async () => ({ access_token: token }), fetch });
  const shared = await store(e.CONSOLE_PROJECT_ID).readSecret("CONSOLE_STRIPE_WEBHOOK_SECRET");
  const site = await store(e.CLIENT_PROJECT_ID).readSecret("TICKETING_WEBHOOK_SECRET");
  if (!shared || !site) throw new Error();
  const id = "evt_lojReceiver20261112";
  const envelope = account => Buffer.from(JSON.stringify({ id, object: "event", type: "account.updated", livemode: true, account, data: { object: { id: account, object: "account" } } }));
  const url = `https://us-central1-${e.CONSOLE_PROJECT_ID}.cloudfunctions.net/stripeConnectWebhook`;
  const send = async (label, target, account, secret, expected, valid = true) => {
    const body = envelope(account), timestamp = Math.floor(Date.now() / 1000);
    const hash = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
    const signature = `t=${timestamp},v1=${valid ? hash : "0".repeat(64)}`;
    const response = await fetch(target, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000), headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body });
    const text = await response.text();
    if (response.status !== expected) throw new Error();
    if (label === "site no-op") {
      const result = JSON.parse(text);
      if (result.ok !== true || result.ignored !== "not_actionable") throw new Error();
    }
    console.log(`${new Date().toISOString()} ${label}: HTTP ${response.status}; event ${id}`);
  };
  await send("bad signature", url, e.STRIPE_ACCOUNT_ID, shared, 400, false);
  await send("unknown account", url, "acct_lojReceiverUnknown20261112", shared, 404);
  await send("site no-op", `https://${e.CLIENT_REGION}-${e.CLIENT_PROJECT_ID}.cloudfunctions.net/ticketingWebhook`, e.STRIPE_ACCOUNT_ID, site, 200);
  await send("shared NC Local", url, e.STRIPE_ACCOUNT_ID, shared, 200);
})().catch(() => { console.error("Delivery proof failed; keep the old endpoint and stop"); process.exitCode = 1; });
'
```

Confirm that the shared endpoint is the only new endpoint, and that every active
connected account has its own reviewed route before allowing additional accounts.

Only after that proof, delete the recorded old NC Local endpoint with platform
credentials. The synthetic probe cannot check Stripe-side configuration, so this
block first retrieves the shared endpoint and checks its live/enabled state,
URL, associated Connect application against the old endpoint, and event types.
It also requires exactly the original and shared endpoints. These checks prevent
an incorrectly configured endpoint from passing the #835 one-time migration.
The creation block already requests those settings; no provider-originated
delivery has yet confirmed them. After migration this runbook is only a release
record. The block checks the old endpoint's exact URL before deletion and
confirms 404; it cannot delete the shared receiver URL. Stripe documents the
Connect application field in the [endpoint object](https://docs.stripe.com/api/webhook_endpoints/object).

```sh
node -e '
const { execFileSync } = require("node:child_process");
const { createSecretStore } = require("./console/functions/src/secretStore.cjs");
const Stripe = require("stripe");
(async () => {
  const e = process.env;
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const credential = { getAccessToken: async () => ({ access_token: token }) };
  const { internals: { WEBHOOK_EVENTS } } = require("./functions/src/ticketing/providers/stripe.cjs");
  const secrets = createSecretStore({ projectId: e.CONSOLE_PROJECT_ID, getAccessToken: () => credential.getAccessToken(), fetch });
  const stripe = new Stripe(await secrets.readSecret("CONSOLE_STRIPE_SECRET_KEY"));
  const endpoint = await stripe.webhookEndpoints.retrieve(e.OLD_ENDPOINT_ID);
  if (endpoint.url !== `https://${e.CLIENT_REGION}-${e.CLIENT_PROJECT_ID}.cloudfunctions.net/ticketingWebhook`) throw new Error();
  const sharedUrl = `https://us-central1-${e.CONSOLE_PROJECT_ID}.cloudfunctions.net/stripeConnectWebhook`;
  const endpoints = [];
  for await (const item of stripe.webhookEndpoints.list({ limit: 100 })) endpoints.push(item);
  const shared = endpoints.find(item => item.url === sharedUrl);
  if (endpoints.length !== 2 || !endpoints.some(item => item.id === endpoint.id) || !shared) throw new Error();
  const current = await stripe.webhookEndpoints.retrieve(shared.id);
  if (current.url !== sharedUrl || current.status !== "enabled" || current.livemode !== true ||
      !current.application || current.application !== endpoint.application ||
      !WEBHOOK_EVENTS.every(type => current.enabled_events.includes(type))) throw new Error();
  console.log(`${new Date().toISOString()} shared endpoint ${current.id} verified live, enabled, Connect, exact URL and reviewed events`);
  await stripe.webhookEndpoints.del(endpoint.id);
  let absent = false;
  try { await stripe.webhookEndpoints.retrieve(endpoint.id); } catch (err) { if (err.statusCode === 404) absent = true; else throw err; }
  if (!absent) throw new Error();
  console.log(`Old endpoint ${endpoint.id} confirmed absent`);
})().catch(() => { console.error("Old endpoint cleanup failed; keep new live connections closed"); process.exitCode = 1; });
'
```

Repeat the synthetic proof above after deletion and confirm NC Local still
responds successfully. Record endpoint IDs, commit, delivery status and event ID in the
coordinator's deployment receipt; keep payment payloads and secrets out of it.

## 6. Activate provisioning and remove the migration restriction

After the coordinator authorizes merging the reviewed provisioner change to
`main`, run the normal reviewed Console deployment. Live builds create routes;
they never create site endpoints.
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
