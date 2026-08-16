# Roadmap

v1 is five phases. The architecture spec and triage record are the contract. Issues in this repo are the queue.

## M1: Prerequisites and repo bootstrap

Legal and operator setup that gated the public repo.

- Copyright holder and LICENSE grantor: Center for Cooperative Media
- CCM GitHub organization with operator admin
- Trademark screen and domain acquisition for the working name
- Postmark account (one account, per-client message streams)
- Workspaces layout, day-one legal files, credential-free CI

## M2: Scaffold and core port

A fresh Firebase project boots to a working generic event site, including event-neutral emailed-code login.

- Event configuration layer (deploy-time env + runtime `config/*`)
- Shared workspace package with functions vendor packing
- Email core and adapters (Postmark, webhook, console)
- Operator notifier and telemetry
- OTP authentication with tokenized templates
- CMS content with two-revision draft/publish
- Pages-as-data
- Admin config mutation endpoints
- Theming
- Schedule and bookmarks
- Attendee profiles
- `init-event` bootstrap
- Credential-free CI and per-client deploy matrix

## M3: Feature port wave

- Speaker canonical store and invite pipeline
- Speaker profile wizard and public pages
- Session materials (two collections, embargo)
- Media library with Storage rules hardening
- Session reactions
- Badges from per-event config
- Schedule PDF and `updatesMeta` SSR
- Live-updates admin form and feedback inbox

## M4: Ticketing adapter

Last, because everything else has to be stable first.

- TicketingProvider core (tickets collection, webhook dedup, sync queue)
- Eventbrite adapter
- Manual/CSV adapter
- Registration state machine
- Provider-owned registration prompts and ticket templates

## M5: Packaging and transfer

- Operator documentation (deploy runbook, client onboarding, admin guide)
- Public demo instance with synthetic event
- Cloud Run site-publisher
- Community scaffolding completion
- E2E suite on emulators in CI
- First public push and issue migration (this repository)

## After v1

- Simple announcements email on the provider abstraction
- More ticketing adapters
- Social layer or speaker chat only if a client pays for them
- Multi-tenant single-deployment architecture only if deploy-per-client stops scaling

See [docs/adr/0001-event-platform-v1.md](adr/0001-event-platform-v1.md) and [docs/plans/2026-08-16-event-platform-v1-triage.md](plans/2026-08-16-event-platform-v1-triage.md).
