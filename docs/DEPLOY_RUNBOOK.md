# Deploy runbook

One-time setup an operator does per client deployment, before the first `workflow_dispatch` run of
`deploy.yml`. Everything here is provisioned once; `deploy-client.yml` (spec
`docs/adr/0001-event-platform-v1.md` §8.1) then runs unattended. There is no service-account key
anywhere in this flow — auth is Workload Identity Federation (WIF), so nothing here is a secret an
operator has to store, rotate manually, or worry about leaking from a runner log.

Replace every `<...>` placeholder below. Nothing here is a value you leave as written.

## 0. Naming

Pick, once:

- `<GCP_PROJECT_ID>` — the Firebase/GCP project for this client (create it first —
  §2 below covers Firebase-specific prerequisites).
- `<GH_ORG>/<GH_REPO>` — this repository, e.g. `your-org/run-of-show`.
- `<CLIENT_ENV>` — the GitHub Environment name for this client, e.g. `cjs2027`. This is the
  value operators pass as `client` to `workflow_dispatch`, and it must exactly match the
  `AUTO_DEPLOY_ENVIRONMENTS` entry if this client also auto-deploys on push (§4).
- `<DEPLOY_SA>` — the deploy service account's short name, e.g. `deploy-cjs2027`.

## 1. Workload Identity Federation

One pool can be shared across every client deployment in this GCP project (or organization); create
it once, then add one provider (or reuse the existing one) and one service account per client.

```sh
gcloud config set project <GCP_PROJECT_ID>

# One-time per GCP project — skip if it already exists.
gcloud iam workload-identity-pools create "github-actions" \
  --location="global" \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "github" \
  --location="global" \
  --workload-identity-pool="github-actions" \
  --display-name="GitHub OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref,attribute.repository_and_ref=assertion.repository + '#' + assertion.ref" \
  --attribute-condition="assertion.repository_owner == '<GH_ORG>'" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

`--attribute-condition` is the guardrail: without it, any GitHub Actions workflow from any repo that
can forge a matching subject claim could request a token. Scoping it to `repository_owner` is enough
at the *pool* level because the per-client principal binding below (§2) does the real narrowing —
down to one repository **and** one ref (`refs/heads/main`) together. `attribute.repository_and_ref`
is a mapped custom attribute for exactly that: IAM `principalSet` bindings match on a single
attribute value, and a repository-only or ref-only binding cannot be combined with a second one
(multiple `principalSet` members on a role binding are OR'd, not AND'd) — so a repository+ref
compound value is the only way to express "this repo, this branch, nothing else" as one condition.

**This closes a real gap, not a theoretical one.** Binding only on `attribute.repository` (an
earlier draft of this runbook did exactly that) lets *any* workflow run in this repository —
including one dispatched by a collaborator against a feature branch via
`gh workflow run deploy.yml --ref <branch> -f client=<env>` — impersonate the deploy service
account and ship that branch's code with the client's real credentials. An in-workflow ref check
(`deploy-client.yml`'s `guard` job) is necessary but not sufficient on its own: it runs as
code *from the ref being deployed*, so a workflow-modifying commit on that same branch could remove
or bypass the check before GCP is ever asked. The `principalSet` condition is enforced by Google's
IAM outside the runner and outside the repository's control entirely, which is why it is the primary
control and the in-workflow check is defense-in-depth only.

Capture the full provider resource name — every client's `WIF_PROVIDER` environment variable (§3)
is the same value:

```sh
gcloud iam workload-identity-pools providers describe "github" \
  --location="global" \
  --workload-identity-pool="github-actions" \
  --format="value(name)"
# projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-actions/providers/github
```

## 2. Per-client service account

Firebase project prerequisites, first (once per client GCP project):

```sh
gcloud services enable \
  firebase.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  --project=<GCP_PROJECT_ID>

# If the project has never had Firebase added:
#   https://console.firebase.google.com/ → Add project → select <GCP_PROJECT_ID>
# Then, in the console: enable Firestore (Native mode), enable Storage, add a
# Hosting site (or use the default one — its ID is EVENT_HOSTING_SITE, §3).
```

Now the deploy principal:

```sh
gcloud iam service-accounts create "<DEPLOY_SA>" \
  --project=<GCP_PROJECT_ID> \
  --display-name="Run of Show deploy (<CLIENT_ENV>)"

DEPLOY_SA_EMAIL="<DEPLOY_SA>@<GCP_PROJECT_ID>.iam.gserviceaccount.com"

for role in \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/storage.admin \
  roles/cloudfunctions.developer \
  roles/run.developer \
  roles/iam.serviceAccountUser \
  roles/secretmanager.secretAccessor \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.writer \
  roles/serviceusage.serviceUsageConsumer \
  roles/datastore.user \
  roles/cloudscheduler.admin
do
  gcloud projects add-iam-policy-binding <GCP_PROJECT_ID> \
    --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
    --role="${role}" \
    --condition=None
done
```

Notes on that list: `cloudfunctions.developer` + `run.developer` + `iam.serviceAccountUser` +
`cloudbuild.builds.editor` + `artifactregistry.writer` are what `firebase deploy --only functions`
needs end to end (Cloud Functions v2 builds through Cloud Build and Artifact Registry, and the
deploying principal must be allowed to act as the runtime service account).
`secretmanager.secretAccessor` is required only once the environment actually uses a secret
(`EMAIL_PROVIDER_API_KEY` etc., spec §2.1) — grant it up front so onboarding a provider later is a
config change, not an IAM change. **This binding is only what the *deploying* identity needs to
reference a secret while wiring up `defineSecret` at deploy time — it does NOT cover the deployed
function actually reading the secret's value at runtime. That is a separate binding, on the
project's default compute service account, done per secret in §2's Secret Manager step below; skip
it and every `defineSecret`-backed function fails at cold start or at read, not at deploy.**
`datastore.user` is what `generate-content.cjs` needs to read Firestore at deploy time (spec §8.6);
`datastore.indexAdmin` is separate and is what deploys `firestore.indexes.json`.
`cloudscheduler.admin` is what `firebase deploy --only functions` needs to create/update the Cloud
Scheduler job behind `cleanupExpiredAuthChallenges` (an `onSchedule` v2 function,
`functions/src/auth/otp.cjs`) — every deployment has at least this one scheduled function, so the
role is not conditional the way `secretmanager.secretAccessor` is.

Bind the deploy service account so **only** this repository, on `refs/heads/main`, may impersonate
it — both conditions in one `principalSet`, via the combined attribute mapped in §1:

```sh
gcloud iam service-accounts add-iam-policy-binding "${DEPLOY_SA_EMAIL}" \
  --project=<GCP_PROJECT_ID> \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-actions/attribute.repository_and_ref/<GH_ORG>/<GH_REPO>#refs/heads/main"
```

Verify it — the policy should show exactly one member, and it must end in `#refs/heads/main`:

```sh
gcloud iam service-accounts get-iam-policy "${DEPLOY_SA_EMAIL}" --project=<GCP_PROJECT_ID> \
  --format="json(bindings)"
```

This is the actual enforcement. It holds regardless of what any workflow file in the repository
says, because Google's OIDC token exchange evaluates the `ref` claim GitHub put in the token — not
anything the workflow run controls — before minting a credential. A `workflow_dispatch` run against
a feature branch (`--ref some-branch`) presents a token whose `repository_and_ref` attribute does
not match `<GH_ORG>/<GH_REPO>#refs/heads/main`, so `google-github-actions/auth` fails at the token
exchange with `permission_denied` — before `deploy-client.yml` runs a single deploy step, and even
if that workflow's own `guard` job ref check had been edited or removed on that branch.
`workflow_dispatch` from `main` itself is unaffected: its ref is `refs/heads/main`, which matches.

**Second layer: a GitHub-side deployment branch rule.** Belt-and-suspenders, and cheap to set up —
repo Settings → Environments → `<CLIENT_ENV>` → Deployment branches and tags → **Selected branches
and tags** → add `main` only. This makes GitHub itself refuse to start any job whose `environment:`
is `<CLIENT_ENV>` unless the run's ref is `main`, independent of both the WIF condition and the
in-workflow check. Combine it with **Required reviewers** on the same screen for any client where a
human should see a dispatch before it runs.

## 3. GitHub Environment

Create the environment (repo Settings → Environments → New environment → name it exactly
`<CLIENT_ENV>`), then set its variables and secrets. **Every value below is a GitHub Environment
variable (`vars.*`), not a secret** — none of it is a credential; the credential-shaped value
(the WIF provider resource name, the service account email) is a Google-side ACL check, not a
bearer token, and none of the Tier A values are confidential either.

| Variable | Value |
|---|---|
| `WIF_PROVIDER` | the provider resource name from §1's `describe` output |
| `WIF_SERVICE_ACCOUNT` | `<DEPLOY_SA>@<GCP_PROJECT_ID>.iam.gserviceaccount.com` |
| `EVENT_SLUG` | lowercase identifier, e.g. `cjs2027` |
| `EVENT_FIREBASE_PROJECT_ID` | `<GCP_PROJECT_ID>` |
| `EVENT_FIREBASE_REGION` | `us-central1` unless the project's functions live elsewhere |
| `EVENT_HOSTING_SITE` | the Firebase Hosting site ID (Console → Hosting) |
| `EVENT_PUBLIC_URL` | canonical origin, e.g. `https://summit.example.org` |
| `EVENT_STORAGE_BUCKET` | the project's default Storage bucket |
| `EVENT_ALLOWED_ORIGINS` | comma-separated CORS origins |
| `EVENT_EMAIL_PROVIDER` | `postmark` \| `webhook` \| `console` |
| `EVENT_TICKETING_PROVIDER` | `eventbrite` \| `manual` \| `none` |
| `EVENT_TICKETING_EVENT_ID` | required only when the ticketing provider is `eventbrite` |
| `EVENT_OPERATOR_NOTIFIER` | `webhook` \| `email` \| `none` |
| `EVENT_APP_CHECK_ENFORCED` | `false` by default; set the App Check site key before changing this to `true` |
| `EVENT_OTP_SEND_CEILING_PER_HOUR` | positive integer; defaults to `500` |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID` | from Firebase Console → Project settings → your web app's SDK config |
| `VITE_FIREBASE_APP_CHECK_SITE_KEY` | reCAPTCHA v3 site key; set this before enabling App Check enforcement |

App Check activation requires two successful deploys. First set
`VITE_FIREBASE_APP_CHECK_SITE_KEY` and wait for that deploy to finish. Then set
`EVENT_APP_CHECK_ENFORCED=true` and deploy again. Do not enable both settings in
the first deploy because Functions deploys before the new web bundle.

Full list, with descriptions: `.env.example`.

The **only** secrets `deploy-client.yml` reads are the provider-specific ones from spec §2.1/§8.2 —
set them here too, as environment **secrets** (Settings → Environments → `<CLIENT_ENV>` → Secrets),
only the rows that apply to the providers selected above:

| Secret | Required when |
|---|---|
| `EMAIL_PROVIDER_API_KEY` | `EVENT_EMAIL_PROVIDER = postmark` |
| `EMAIL_WEBHOOK_BASIC_AUTH` | `EVENT_EMAIL_PROVIDER = postmark` and delivery-event ingest is enabled |
| `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_SECRET` | `EVENT_EMAIL_PROVIDER = webhook` |
| `TICKETING_API_TOKEN` | `EVENT_TICKETING_PROVIDER != none` |
| `TICKETING_WEBHOOK_SECRET` | ticketing provider implements `registerWebhook` (`eventbrite` — never `manual`) |
| `OPERATOR_WEBHOOK_URL`, `OPERATOR_WEBHOOK_SECRET` | `EVENT_OPERATOR_NOTIFIER = webhook` |

There is deliberately no `FIREBASE_SERVICE_ACCOUNT` secret in this list — WIF (§1–2) replaces the
service-account-key deploy credential entirely.

These provider secrets are consumed by the deployed Cloud Functions through `defineSecret` (Secret
Manager), not baked into the functions env file the `functions` job writes — create them in Secret
Manager once, before the first functions deploy for this client:

```sh
echo -n "<the actual API key>" | gcloud secrets create EMAIL_PROVIDER_API_KEY \
  --project=<GCP_PROJECT_ID> --data-file=- --replication-policy=automatic
# repeat per secret this client's provider selection actually needs
```

**Then bind `secretAccessor` on each secret to the function's RUNTIME service account — not the
deploy service account.** These are two different identities with two different jobs: `${DEPLOY_SA_EMAIL}`
(§2, above) only needs to *reference* the secret while deploying; the function's runtime identity is
what actually reads the secret's value on every invocation, and it is a separate principal that
`${DEPLOY_SA_EMAIL}`'s own `secretmanager.secretAccessor` grant does not cover. Cloud Functions v2
runs as the project's default compute service account unless a function explicitly sets
`serviceAccount` (this repo's functions do not), so:

```sh
PROJECT_NUMBER=$(gcloud projects describe <GCP_PROJECT_ID> --format="value(projectNumber)")
RUNTIME_SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in EMAIL_PROVIDER_API_KEY; do   # repeat the list for every secret this client uses
  gcloud secrets add-iam-policy-binding "${secret}" \
    --project=<GCP_PROJECT_ID> \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor"
done
```

Skipping this step is a deploy-succeeds-runtime-fails trap: `firebase deploy --only functions` does
not read the secret's value, so the deploy itself can succeed with this binding missing, and the
function then fails at cold start (or at the first read, depending on `defineSecret` vs. lazy access)
with a Secret Manager permission error — which surfaces as a broken client feature, not a red CI run.

(Optional) restrict who can approve deploys to this environment: Settings → Environments →
`<CLIENT_ENV>` → Deployment protection rules → Required reviewers.

## 4. AUTO_DEPLOY_ENVIRONMENTS (push auto-deploy)

Repository-level, not per-environment (repo Settings → Secrets and variables → Actions →
Variables → New repository variable):

```
Name:  AUTO_DEPLOY_ENVIRONMENTS
Value: cjs2027,summit2026
```

A comma-separated list of `<CLIENT_ENV>` names. Every push to `main` fans out to each one (spec
§8.1) — `deploy.yml`'s `resolve` job parses this (`scripts/lib/deploy-matrix.cjs`), and a client
absent from the list only ever deploys via `workflow_dispatch`. Leave it unset (or empty) while a
client is new and you want every deploy to be a manual, watched dispatch; add it once the client is
comfortable auto-deploying on merge.

## 5. First deploy (provisioning a fresh project)

A brand-new project has no `config/event` Firestore document yet — `generate-content.cjs` (the
`content` job) throws "run scripts/init-event.cjs first" against one, on purpose (spec §8.6). The
`content` job runs before any operator has ever had the chance to run `init-event.cjs`, so the first
dispatch against a fresh project has to skip it. Two dispatches, in order:

**Step 1 — bootstrap dispatch.** Deploys only rules/indexes/storage (`provision`) and `functions`;
skips `content`/`build`/`hosting`/`smoke` entirely.

```
Actions tab → Deploy → Run workflow
  client: <CLIENT_ENV>
  provision: true
  bootstrap: true
```

`deploy-client.yml`'s `provision` job deploys `firestore:rules`, `firestore:indexes`, and `storage`
on **every** run regardless of the `provision` input (spec §8.1) — that input exists for operator
intent and log clarity, not as a gate. `bootstrap: true` is the actual gate: it is what skips
`content` (and, transitively, `build`/`hosting`/`smoke`) on this run. A dispatch run always deploys
functions regardless of `bootstrap`, because a fresh project has none yet and gating that on a paths
filter would provision an empty, broken deployment (spec §8.1).

**Step 2 — seed content**, from an operator's machine, once the bootstrap dispatch succeeds:

```sh
export FIRESTORE_EMULATOR_HOST=  # unset — this targets the real project
export EVENT_FIREBASE_PROJECT_ID=<GCP_PROJECT_ID>
export GOOGLE_APPLICATION_CREDENTIALS=<path to your own gcloud ADC, for this one-time step>
node scripts/init-event.cjs --answers client-answers.json --admin ops@example.org
node scripts/init-event.cjs --check
```

`init-event.cjs` runs from an operator's machine (or a follow-up dispatch of a future
provisioning workflow), not from `deploy-client.yml` — it is the one-time content bootstrap, not a
repeatable deploy step. See `scripts/README.md`.

**Step 3 — normal dispatch**, now that `config/event` exists:

```
Actions tab → Deploy → Run workflow
  client: <CLIENT_ENV>
  provision: false
  bootstrap: false   (the default — leave it unchecked)
```

This run's `content` job succeeds, and `build`/`hosting`/`smoke` deploy the live site. From here on,
either dispatch this way again for any change, or add `<CLIENT_ENV>` to `AUTO_DEPLOY_ENVIRONMENTS`
(§4) so a push to `main` deploys it automatically — `bootstrap` is never `true` on a push run, so a
client already past step 3 never needs it again.

## 6. Verifying the setup

- `gcloud iam service-accounts get-iam-policy "${DEPLOY_SA_EMAIL}" --project=<GCP_PROJECT_ID>
  --format="json(bindings)"` shows the `workloadIdentityUser` binding from §2, and its member ends
  in `.../attribute.repository_and_ref/<GH_ORG>/<GH_REPO>#refs/heads/main` — not
  `attribute.repository/<GH_ORG>/<GH_REPO>` alone. A repository-only binding is the gap this runbook
  now closes: it lets any dispatched run on any branch of this repository impersonate the deploy
  service account.
- Confirm the negative case, not just the positive one: `gh workflow run deploy.yml --ref
  <some-non-main-branch> -f client=<CLIENT_ENV>` must fail at the `google-github-actions/auth` step
  with a token-exchange `permission_denied` — that is the WIF condition doing its job. It should
  also fail earlier, at "Waiting for review" or immediately, if the deployment branch rule (§2) is
  set, since GitHub itself won't start a job against `<CLIENT_ENV>` from that ref.
- A `workflow_dispatch` run of `deploy.yml` with `client: <CLIENT_ENV>` **from `main`** should reach
  the `smoke` job and pass — it OPTIONS-preflights every endpoint in `.github/smoke-endpoints.json`
  against `https://<EVENT_FIREBASE_REGION>-<EVENT_FIREBASE_PROJECT_ID>.cloudfunctions.net` and GETs
  `EVENT_PUBLIC_URL`.
- If `google-github-actions/auth` fails with `permission_denied` on a run you expected to succeed
  (dispatched from `main`), the attribute condition (§1) or the repository+ref binding (§2) is the
  first thing to re-check — copy the exact `repository` and `ref` claims GitHub sent from the failed
  run's log against what the binding names.

## 7. Rotating access

There is no key to rotate. To revoke a client's deploy access, remove the IAM policy binding from
§2 (`gcloud iam service-accounts remove-iam-policy-binding`) or delete the GitHub Environment; both
take effect on the next run, immediately.
