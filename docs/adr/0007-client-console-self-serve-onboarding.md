# ADR 0007: Client console for self-serve onboarding and provisioning

**Date:** 2026-11-03  
**Status:** Accepted by the owner on 2026-11-03.  
**Amends:** [ADR 0001 §2](0001-event-platform-v1.md) operating model. The model stays one Firebase project per event. This record adds a way to request, approve and create those projects.

## Context

Today a client starts by email. The operator collects the answers by hand, writes
`client-answers.json`, works through `docs/DEPLOY_RUNBOOK.md` §0 to §5 with `gcloud` and the
Firebase console, then runs `scripts/init-event.cjs`. The steps are correct but they are long, and
the client cannot see where their event is in the process.

NC Local is the first outside client (#337, #516). The owner asked for an easy process for them and
for later clients, in two stages:

1. Before a project exists: the client creates an account, fills in a step-by-step form, and submits
   it. CCM reviews it. Approval creates the project automatically.
2. After the project exists: the client's first operator signs in to their own admin panel and
   works through a setup checklist to launch.

The owner chose self-serve sign-up with automatic provisioning, and a form that submits to a
server (2026-11-03).

## Decision

### 1. A separate console project

The console is a new small app in its own Firebase project, owned by CCM (working id
`eventrunner-console`), at `console.eventrunner.org`. It is not deployed to any client project, and no client project reads from
it. Code lives in `console/` with its own `firebase.json`, rules, web app and functions, so the
client deploy (`deploy-client.yml`) never ships it.

The console holds accounts of client contacts, their applications, and provisioning status. It
holds no attendee data and no provider secrets.

### 2. Account creation

- A client contact signs up with Google or an emailed sign-in link (Firebase Auth in the console
  project). The email address must be verified before a submit.
- One account can own more than one application (a second event is a second application and a
  second project).
- CCM operators are named in `console_config/operators` (lowercase emails), the same pattern as
  `config/bootstrap` in an event project. Operators see every application. A client sees only its
  own.

### 3. The intake form

A step-by-step form. Each step saves a draft. A person can leave and come back.

| Step | Asks for |
| --- | --- |
| Organization | Legal name, website, postal address for the email footer |
| Event | Name, short name, tagline, timezone, days, venue |
| Team | Two or more operators (required; launch readiness needs two), staff (optional), the named owner |
| Web address | A `*.eventrunner.org` subdomain or the client's own domain |
| Tickets | Stripe, Eventbrite, spreadsheet import, or none; registration window |
| Email | Sender address on the client's own domain, sender name, support and conduct addresses |
| Review | A readable summary and a submit button |

Rules:

- The form validates with the same code `init-event.cjs` uses. The pure answer builder moves from
  `scripts/lib/answers.cjs` to `packages/shared` so the browser, the console functions and the CLI
  run one validator. A submit that the CLI would refuse is refused at submit.
- The form never asks for a key, token or password. Stripe keys, Eventbrite tokens and Postmark
  server tokens are collected by the operator through the existing provider steps. The form says
  so on the Tickets and Email steps.
- `submitApplication` is a callable function. It re-validates on the server, freezes the answers,
  sets status `submitted`, writes an audit row, and notifies operators by email. It is rate limited:
  at most three open applications per account and five submits per account per day.

### 4. Review and approval

Statuses: `draft` → `submitted` → `changes_requested` (back to the client with a note) or
`approved` → `provisioning` → `ready` → `launched`. Also `withdrawn` (by the client) and
`declined` (by an operator, with a note).

An operator approves with four values the client does not choose: the GCP project id, the
billing account, the region, and the GitHub Environment name. **No cloud resource is created before
an operator approves.** This is the main control against cost and abuse from self-serve sign-up.

### 5. Provisioning runs in GitHub Actions, not in a console function

Approval dispatches a new workflow, `provision-client.yml`, with the application id. The workflow
authenticates with Workload Identity Federation as a provisioner service account, bound to this
repository on `refs/heads/main` only, the same pattern as the deploy account (runbook §1 and §2).

Reasons:

- The provisioner needs organization-level roles: project creator on one dedicated folder and
  billing user on one billing account. A credential with these roles must not sit behind an
  internet-facing function.
- The deploy already runs in Actions with WIF. Provisioning reuses that trust and leaves a run log.
- The console needs only one narrow credential: a GitHub App installation token with
  `actions: write` on this repository, in the console's Secret Manager, to dispatch the workflow.

The workflow runs `scripts/provision-client.cjs`. It is a list of idempotent steps. Each step reads
the current state first and does nothing when the state is already right, so a failed run is
repaired and run again with the same input. Each step writes its result to the application's
`provisioning` record in the console, which the client and the operator both see.

Automated steps (runbook section in brackets):

1. Create the project in the dedicated folder and link the billing account [§0].
2. Enable the APIs, add Firebase, create Firestore (Native), the default bucket, the Hosting site
   and the web app; read the web app config [§2].
3. Create the deploy service account, grant its roles, bind WIF to `refs/heads/main`, grant the
   Storage and Pub/Sub service agent roles [§2].
4. Create the GitHub Environment, its `main`-only branch rule and its variables [§3].
5. Run the bootstrap dispatch and wait for it [§5 step 1].
6. Run `init-event.cjs` with the frozen answers and the named operators [§5 step 2].
7. Email the client's operators a link to their admin panel. Set status `ready`.

Steps that stay manual, and why:

| Step | Why it stays with a person |
| --- | --- |
| Provider secrets (Stripe, Eventbrite, Postmark) | The client owns these accounts. Keys are entered by the operator into Secret Manager. |
| Google sign-in provider and authorized domains | Needs an OAuth client and a consent screen. Firebase has no stable API for it. |
| DNS for the custom domain and the sender domain | The client controls their DNS. |
| Legal review | A human sign-off by the client's counsel. |
| Normal deploy dispatch and go-live | Gated on `init-event.cjs --check`, as today. |

### 6. Setup checklist in the event admin (stage 2)

A new admin page, **Set up your event** (`/admin/setup`), shows the launch-readiness rows from
`shared/readiness` as a checklist. Each row says who does it (you or CCM), its state, and a link to
the screen that clears it: Settings → Access for the second operator, Branding, Content, Event
settings and Ticketing. It replaces no existing check: `init-event.cjs --check` stays the gate.
The page reads the rows from `webMcpCheckEventReadiness`, which already runs that policy for
staff, so no new endpoint is needed. That check now reads the config fresh, not from the
five-minute container cache, so a step shows Done as soon as the server sees the change. It is on the rail under Overview. The overview does not call
the check, so its figures load as before.

The page also holds the legal sign-off. An operator confirms that counsel approved both pages, and
the page saves `legal.reviewRequired: false` through `updateEventConfig`. Before this page, no
admin screen wrote that field, although the onboarding docs said Settings did.

The page names the deploying organization "the hosting team", not CCM, because the code is
white-label.

This stage does not depend on the console. It helps any client, including one onboarded by hand.

## Consequences

- A client sees their own progress from sign-up to launch. CCM types no answers by hand.
- CCM runs one more Firebase project, one more workflow, one GitHub App and one provisioner service
  account with folder-level roles. The one-time setup goes in a new runbook section.
- Self-serve sign-up adds a public write surface: rate limits, verified email, App Check on the
  console, and an operator delete action for spam applications.
- Retention: a withdrawn or declined application is deleted 90 days after its last change. An
  approved application is kept with the client's records for the life of the engagement.
- CI stays credential-free. Provisioning steps are tested against fake GCP and GitHub clients. Real
  provisioning is proved once by the owner in a test folder before NC Local uses it.

## Not in scope

- Taking payment or signing the agreement in the console.
- Automatic DNS changes, Stripe Connect onboarding, or Postmark server creation.
- Changing anything in an event project after `ready`, except through the existing admin panel and
  deploy workflows.
- Moving existing clients into the console.

## Owner answers (2026-11-03)

1. Console address: `console.eventrunner.org`.
2. NC Local goes through the console as its first real user. The console must be proved in a test
   folder before NC Local uses it (P8 in `tasks/todo.md`).

3. Legal: CCM's legal review cleared this project (owner report, 2026-11-03). This covers the
   console and its intake of client contact data. It does not replace the per-event legal review
   step: each client's counsel still approves that event's privacy policy and terms.

## Open question

The GCP folder and the billing account that client projects go into.
