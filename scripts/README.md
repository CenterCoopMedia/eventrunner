# scripts

Operator tools.

Landed: `prepare-functions.cjs` — packs `packages/shared` into `functions/vendor/shared.tgz` (spec §1.1); run by CI and the `firebase.json` functions predeploy hook.

Planned: `init-event`, `generate-content`, `grant-admin`, `seed-demo-event`, `verify-sender-domain`, `register-ticketing-webhook`, `export-attendees`, `generate-favicons`. Credentials go through `scripts/lib/firebase-init.cjs` and the Tier A env vars. No hardcoded project IDs.
