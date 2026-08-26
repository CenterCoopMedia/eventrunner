# Roadmap

v1 is five phases. The architecture spec and triage record are the contract. Issues in this repo are the queue.

## M1: Prerequisites and repo bootstrap — effectively complete

Legal and operator setup that gated the public repo. Two residual operator tasks are closing today.

- [x] Copyright holder and LICENSE grantor: Center for Cooperative Media
- [x] CCM GitHub organization with operator admin
- [x] Trademark screen and domain acquisition for the working name
- [x] Postmark account (one account, per-client message streams)
- [x] Workspaces layout, day-one legal files, credential-free CI

## M2: Scaffold and core port — complete

A fresh Firebase project boots to a working generic event site, including event-neutral emailed-code login.

- [x] Event configuration layer (deploy-time env + runtime `config/*`)
- [x] Shared workspace package with functions vendor packing
- [x] Email core and adapters (Postmark, webhook, console)
- [x] Operator notifier and telemetry
- [x] OTP authentication with tokenized templates
- [x] CMS content with two-revision draft/publish
- [x] Pages-as-data
- [x] Admin config mutation endpoints
- [x] Theming
- [x] Schedule and bookmarks
- [x] Attendee profiles
- [x] `init-event` bootstrap
- [x] Credential-free CI and per-client deploy matrix

## M3: Feature port wave — complete

- [x] Speaker canonical store and invite pipeline
- [x] Speaker profile wizard and public pages
- [x] Session materials (two collections, embargo)
- [x] Media library with Storage rules hardening
- [x] Session reactions
- [x] Badges from per-event config
- [x] Schedule PDF and `updatesMeta` SSR
- [x] Live-updates admin form and feedback inbox

## M4: Ticketing adapter — complete

Last, because everything else has to be stable first.

- [x] TicketingProvider core (tickets collection, webhook dedup, sync queue)
- [x] Eventbrite adapter
- [x] Manual/CSV adapter
- [x] Registration state machine
- [x] Provider-owned registration prompts and ticket templates

## M5: Packaging and transfer — in progress (~77%)

- [x] Operator documentation (deploy runbook, client onboarding, admin guide)
- [ ] Public demo instance with synthetic event (#35)
- [x] Cloud Run site-publisher
- [x] Community scaffolding completion
- [x] E2E suite on emulators in CI
- [x] First public push and issue migration (this repository)
- [ ] Eventbrite sandbox verification (#79)

## After v1

- Simple announcements email on the provider abstraction
- More ticketing adapters
- Social layer or speaker chat only if a client pays for them
- Multi-tenant single-deployment architecture only if deploy-per-client stops scaling

See [docs/adr/0001-event-platform-v1.md](adr/0001-event-platform-v1.md) and [docs/plans/2026-08-16-event-platform-v1-triage.md](plans/2026-08-16-event-platform-v1-triage.md).
