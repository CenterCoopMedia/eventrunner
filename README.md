# Run of Show

A white-label event CMS for conferences and gatherings. Each client event gets its own Firebase project. The Center for Cooperative Media deploys and operates it. Client staff run the site from the admin CMS. They never touch the code.

**License:** [Apache-2.0](LICENSE). The code is free. The trademark is the exclusivity lever: nobody else can market hosting under this name.

**Status:** Public extraction in progress. The [v1 architecture spec](docs/adr/0001-event-platform-v1.md) and [feature triage](docs/plans/2026-08-16-event-platform-v1-triage.md) are the contract. Work is tracked on the [roadmap](docs/ROADMAP.md) and the [project board](https://github.com/orgs/CenterCoopMedia/projects/2).

Site: [centercoopmedia.github.io/eventrunner](https://centercoopmedia.github.io/eventrunner/)
Handbook: [wiki](https://github.com/CenterCoopMedia/eventrunner/wiki)

A public demo instance and README screenshots are pending the operator's deploy of that instance
(see [#35](https://github.com/CenterCoopMedia/eventrunner/issues/35)) — this section gets the link
and images once that deployment exists.

## Who it is for

Nonprofit and journalism organizations, universities, and event producers who want a staff-run event site: schedule, speakers, registration, materials, and a block-based CMS.

The reference implementation is the [2026 Collaborative Journalism Summit](https://summit.collaborativejournalism.org) site (`jamditis/cjs2026`). That repo stays the live production event. This repo is a new extract, not a fork. Features cut from v1 stay in the summit repo.

## What v1 includes

- Block-based CMS with draft/publish
- Schedule, sessions, bookmarks, ICS/calendar links
- Speaker invite, accept, profile, and approval
- Attendee directory and profiles
- Sponsors and organizations
- Google sign-in and emailed 6-digit OTP codes
- Session materials with embargo
- Media library
- Eventbrite plus manual/CSV ticketing adapters
- Per-event theming
- Transactional email through a provider adapter (Postmark is the reference)

What v1 does not include is listed in the [triage record](docs/plans/2026-08-16-event-platform-v1-triage.md). Video generation, bulk broadcast email, invoicing, Airtable, social feeds, and speaker chat stay out.

## Operating model

One Firebase project per client event. Configuration is two tiers:

1. **Deploy-time** environment variables (project id, providers, public URL). Documented in [`.env.example`](.env.example).
2. **Runtime** Firestore `config/*` documents that client admins edit: name, dates, venue, theme, badges.

See spec §2.

## Repo layout

```
apps/web            Vite frontend (not landed yet)
functions           Cloud Functions by domain module (not landed yet)
packages/shared     Config schema, lifecycle clock, time, registration, badges
scripts             Operator tools (not landed yet)
docs                Spec, roadmap, and the GitHub Pages site
```

`packages/shared` is CommonJS with hand-written ESM shims so the same module serves Vite and Cloud Functions with no transpile step.

## Develop

Node 22+.

```bash
npm test
```

That runs the shared-package suite on Node's built-in test runner. No install step and no credentials. The emulator loop (`npm run dev:emulators`) lands with the web app and functions.

Rules that apply to every PR:

- No hardcoded event name, city, hex color, or domain. Event identity comes from config.
- `ticket_sync_queue` is the only queue in the system.
- CI must stay credential-free so fork PRs can run every check.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License and trademark

Copyright 2026 Center for Cooperative Media. Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Apache-2.0 does not grant trademark rights. "Run of Show" as a product name is reserved to the Center for Cooperative Media.

## Security

Do not open a public issue for a vulnerability. Use [private vulnerability reporting](https://github.com/CenterCoopMedia/eventrunner/security) or email info@collaborativejournalism.org. See [SECURITY.md](SECURITY.md).

Operator-run client deployments are out of scope for public reports. Email the operator of that deployment.

## Support

| You are… | Start here |
|---|---|
| Attendee or event staff with a how-to | [Q&A](https://github.com/CenterCoopMedia/eventrunner/discussions/new?category=q-a) |
| An organization that wants a hosted event | [General](https://github.com/CenterCoopMedia/eventrunner/discussions/new?category=general) |
| Reporting a product bug | [Bug form](https://github.com/CenterCoopMedia/eventrunner/issues/new?template=bug.yml) |
| CCM already hosts your site | info@collaborativejournalism.org |
| Changing the code | [CONTRIBUTING.md](CONTRIBUTING.md) |

The [wiki](https://github.com/CenterCoopMedia/eventrunner/wiki) is the handbook for attendees, staff, and clients. [GOVERNANCE.md](GOVERNANCE.md) is who decides.

An initiative of the Center for Cooperative Media at Montclair State University.
