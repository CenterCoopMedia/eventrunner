# Contributing

Thanks for wanting to help. This is the public platform repo. The live Collaborative Journalism Summit site stays in `jamditis/cjs2026` and is not the place to send platform PRs.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Reports go to info@collaborativejournalism.org.

## Where to start

Pick the path that matches what you are doing. If you are not changing code, you probably want [Discussions](https://github.com/CenterCoopMedia/run-of-show/discussions) or the [handbook](docs/handbook/README.md), not a pull request.

| You are… | Do this |
|---|---|
| An attendee who cannot sign in, find a session, or open materials | [Q&A](https://github.com/CenterCoopMedia/run-of-show/discussions/new?category=q-a) |
| Event staff stuck in the CMS, schedule, or speaker tools | [Q&A](https://github.com/CenterCoopMedia/run-of-show/discussions/new?category=q-a) |
| An organization that wants CCM to run your event | [General](https://github.com/CenterCoopMedia/run-of-show/discussions/new?category=general) or email info@collaborativejournalism.org |
| Reporting a bug in the shared product | [Bug form](https://github.com/CenterCoopMedia/run-of-show/issues/new?template=bug.yml) |
| Asking for a product change | [Feature form](https://github.com/CenterCoopMedia/run-of-show/issues/new?template=feature.yml) |
| Sending code or docs | Open or link an issue, then a pull request |

If CCM is operating the event site for you and the problem is access, content, or your specific deployment, email info@collaborativejournalism.org. That is support, not a public ticket.

## Contribution policy

We take:

- Bug fixes with a failing test when one can exist
- Features that match the [roadmap](docs/ROADMAP.md) or have a linked, accepted issue
- Docs, wiki corrections, and accessibility fixes
- Repro cases that do not include real attendee or client data

We will bounce:

- Hardcoded event names, cities, hex colors, or domains
- Personal infrastructure (hostnames, chat IDs, personal emails, private operator adapters)
- Secrets, live-project credentials, or real PII in tests, fixtures, screenshots, or logs
- A second queue. `ticket_sync_queue` is the only queue in the system
- Features already cut from v1 (video generator, bulk broadcast, invoicing, social feeds, speaker chat) unless a linked issue reopens the case
- Drive-by refactors with no product change

The [governance](GOVERNANCE.md) note is the short version of who decides.

## Dev setup

1. Fork and clone this repository.
2. Use Node 22 or newer (`node -v`).
3. From the repo root:

```bash
npm test
```

No `.env` and no cloud credentials are required for the current suite. The Firebase emulator loop lands with `apps/web` and `functions`. When it does, the command will be `npm run dev:emulators`.

## How to send a change

1. Search issues and the [project board](https://github.com/orgs/CenterCoopMedia/projects/2). The **What this is** column is the plain-language version of each title.
2. Open an issue first if the change is more than a typo. Use the form that matches the work.
3. Branch from `main`. One logical change per branch.
4. Add or update tests next to the code (`*.test.cjs` beside the module).
5. Fill in the pull request template, including how you verified the change.
6. Sign off each commit (`git commit -s`) under the [Developer Certificate of Origin](https://developercertificate.org/).

### Shared package

`packages/shared` is CommonJS first. Add a `.mjs` re-export shim next to every new `.cjs` module.

### Accessibility

UI changes need a keyboard path and visible focus. If you change a flow that attendees or staff use, say how you checked it (keyboard, zoom, or a screen reader). Do not rely on color alone.

## Tests

| Command | What it covers |
|---|---|
| `npm test` | `packages/shared` unit tests (Node `--test`) |

When the web app and functions land, CI will also run lint, Firestore/Storage rules tests on emulators, and Playwright against emulators. Fork PRs must be able to run every check without credentials.

## Security

Do not open a public issue for a vulnerability. Use [private reporting](https://github.com/CenterCoopMedia/run-of-show/security) or see [SECURITY.md](SECURITY.md).

## Questions

- Product and "how do I": [Discussions](https://github.com/CenterCoopMedia/run-of-show/discussions)
- Handbook for attendees, staff, and clients: [docs/handbook](docs/handbook/README.md)
- Hosted-event support: info@collaborativejournalism.org
