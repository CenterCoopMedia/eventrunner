# Contributing

Thanks for wanting to help. This repo is the public platform. The live Collaborative Journalism Summit site stays in `jamditis/cjs2026` and is not the place to send platform PRs.

## Dev setup

1. Fork and clone this repository.
2. Use Node 22 or newer (`node -v`).
3. From the repo root:

```bash
npm test
```

No `.env` and no cloud credentials are required for the current suite. The Firebase emulator loop lands with `apps/web` and `functions`. When it does, the command will be `npm run dev:emulators`.

## How to send a change

1. Open an issue first if the change is more than a small fix. The [roadmap](docs/ROADMAP.md) and open milestones are the queue.
2. Branch from `main`.
3. Keep the pull request to one logical change.
4. Fill in the pull request template.
5. Sign off each commit (`git commit -s`) under the [Developer Certificate of Origin](https://developercertificate.org/).

## Rules that will bounce a PR

- **No hardcoded event identity.** Event name, dates, venue, city, hex colors, and domains come from the config layer. A string that only makes sense for one event is a review failure.
- **No personal infrastructure.** Hostnames, chat IDs, personal emails, and operator-private adapters do not belong in this tree. Operator sinks are a generic webhook.
- **No live-project secrets in CI.** Checks must run on emulators so a fork PR can go green.
- **`ticket_sync_queue` is the only queue.** Do not add another. The email path is send-and-audit, not a queue.
- **Shared package stays CJS-first.** Add a `.mjs` re-export shim next to every new `.cjs` module in `packages/shared`.

## Tests

| Command | What it covers |
|---|---|
| `npm test` | `packages/shared` unit tests (Node `--test`) |

When the web app and functions land, CI will also run lint, Firestore/Storage rules tests on emulators, and Playwright against emulators. Add tests next to the code you change (`*.test.cjs` beside the module).

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Reports go to info@collaborativejournalism.org.

## Questions

Open a [discussion](https://github.com/CenterCoopMedia/run-of-show/discussions) or an issue. If CCM is operating a deployment for you, email info@collaborativejournalism.org instead of filing a support ticket here.
