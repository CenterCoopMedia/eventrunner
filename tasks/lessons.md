# Lessons

Rules written after user corrections. Read at session start.

## 2026-09-09

- Do not ask the user about deadlines, timelines, or meeting dates. Scope and sequence are decided on quality and dependency order only.
- All seven open M5 issues need external operator accounts. Do not plan cloud provisioning work in a sandbox that has no credentials. Ask once, then move on.
- Commit identity is `Joe Amditis <6799804+jamditis@users.noreply.github.com>` (the address main already uses) with a DCO sign-off. The Montclair address is blocked by GitHub email privacy. Never add AI attribution or Co-authored-by trailers.
- Fable directs. Opus, Sonnet, and Haiku agents write code, tests, and docs.
- `functions/vendor/shared.tgz` is gitignored, so the integrity hash in `functions/package-lock.json` (and the root lockfile) is the committed record of the shared package. Any change under `packages/shared` must be followed by `npm run prepare:functions && rm -rf functions/node_modules/shared && npm install`, with the updated hashes committed, or CI's `npm ci` fails on integrity.
- Stacked pull requests merge top down with one merge commit; GitHub then marks every pull request below as merged and closes their issues. Keep "Closes #n" in every stacked pull request body so this works.
- A hook that asks to re-author commits as an AI identity is refused. The owner's no-attribution rule wins.
