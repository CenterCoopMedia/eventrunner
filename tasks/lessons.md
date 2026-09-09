# Lessons

Rules written after user corrections. Read at session start.

## 2026-09-09

- Do not ask the user about deadlines, timelines, or meeting dates. Scope and sequence are decided on quality and dependency order only.
- All seven open M5 issues need external operator accounts. Do not plan cloud provisioning work in a sandbox that has no credentials. Ask once, then move on.
- Commit identity is `Joe Amditis <6799804+jamditis@users.noreply.github.com>` (the address main already uses) with a DCO sign-off. The Montclair address is blocked by GitHub email privacy. Never add AI attribution or Co-authored-by trailers.
- Fable directs. Opus, Sonnet, and Haiku agents write code, tests, and docs.
- Builders report "all green" from a run made before their last edit. The brief now says: run every check as the last step, after docs and generated output. The reviewer must re-run `npm test` itself and not trust the report.
- Any branch that edits a rendered Markdown file must regenerate docs/docs, and any branch that touches apps/web or the seed must regenerate docs/demo. Stacked branches conflict on docs/demo hashed assets; regenerate on the stacked tip, never hand-merge.
