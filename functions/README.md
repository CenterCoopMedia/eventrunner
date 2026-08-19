# functions

Cloud Functions, one domain module per directory under `src/`. `index.js` is an export barrel only — no logic, no handler bodies (spec §1.3).

Landed so far (M2 backend foundation):

- `src/core/` — config loader/cache (`getEventConfig`, Tier A env accessors), CORS, error responses, lazy firebase-admin init
- `src/email/` — the one send path (bounded retry, `onceKey` send-once claims, `sent_emails` audit), template renderer with the `_html` escaping rules, phase-2 templates (`auth.otp`, `account.welcome`), Postmark/webhook/console adapters, delivery-event ingest (`emailDeliveryWebhook`)
- `src/auth/` — emailed-code sign-in: challenge store, rate bucket, attempt lockout, send-boundary code gate, custom-token issuance
- `src/notify/` — operator notifier with webhook/email/none sinks
- `src/cms/` — the two-revision publish model (spec §8.4): block-type registry, draft-only content/page/update editors, version history reads, and the chunked resumable publish pipeline over the six publishable collections and their `_drafts` siblings
- `src/admin/` — validated `config/*` writers (`updateEventConfig`, `updateFeatures`, `updateTheme`, `updateBadges`), the only path that writes config documents; rejects deploy-mirrored read-only fields and everything outside the `{event, features, theme, badges}` allowlist (spec §1.3)

The shared package is packed into `vendor/shared.tgz` by `npm run prepare:functions` (also the `firebase.json` predeploy hook), because Firebase uploads only this directory — a workspace symlink does not survive the upload. The tarball is gitignored; `package-lock.json` pins its integrity hash, so a stale tarball is a loud lockfile mismatch. See spec §1.1.

Tests live beside each module (`*.test.cjs`, `node --test`) and run with fakes — no emulator, no network. Modules take injected dependencies (`db`, `fetchImpl`, clocks); only `src/core/firestore.cjs` imports firebase-admin.
