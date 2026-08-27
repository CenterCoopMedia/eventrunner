#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function replaceOnce(relativePath, before, after) {
  const file = path.join(ROOT, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const first = source.indexOf(before);
  if (first === -1) {
    throw new Error(`${relativePath}: expected text was not found:\n${before}`);
  }
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${relativePath}: expected text appears more than once:\n${before}`);
  }
  fs.writeFileSync(
    file,
    `${source.slice(0, first)}${after}${source.slice(first + before.length)}`,
  );
}

replaceOnce(
  '.github/workflows/ci.yml',
  `      - name: Run ESLint\n        run: npm run lint\n`,
  `      - name: Run ESLint\n        run: npm run lint\n      - name: Check user-facing copy\n        run: npm run check:copy\n`,
);

replaceOnce(
  'docs/ADMIN_GUIDE.md',
  `On a phone — and for anyone reading with a screen reader — the same day reads as a time-ordered list, which is a designed view rather than a lesser one.`,
  `On a phone — and for anyone reading with a screen reader — the same day is a time-ordered list. It contains the same sessions in the same order as the wide-screen grid.`,
);

replaceOnce(
  'docs/CLIENT_ONBOARDING.md',
  `What to do here depends entirely on the provider this client chose — item 5 is written to be\nsatisfiable by every choice, not just Eventbrite, on purpose (a checklist entry a CSV deployment\ncan never complete is a checklist entry operators learn to ignore):`,
  `Complete the step for the provider this client selected. The checklist supports Eventbrite,\nmanual CSV import, and deployments with no ticketing provider:`,
);

replaceOnce(
  'docs/EVENTBRITE_VERIFICATION.md',
  `and id, real order/ticket numeric ids, phone numbers, free-text fields — and replace with obviously\nfake placeholders in the same shape, never \`[REDACTED]\` blocks, since preserving field shape is the`,
  `and id, real order/ticket numeric ids, phone numbers, and free-text fields. Replace them with clearly\nsynthetic placeholders in the same shape. Do not use \`[REDACTED]\` blocks because preserving field shape is the`,
);

replaceOnce(
  'docs/DEPLOY_RUNBOOK.md',
  `- Confirm the negative case, not just the positive one: \`gh workflow run deploy.yml --ref`,
  `- Confirm the negative case as well: \`gh workflow run deploy.yml --ref`,
);

replaceOnce(
  'docs/POSTMARK_PROVISIONING.md',
  `   each client is a Server, so the plan needs to scale with the client count, not just message\n   volume.`,
  `   each client is a Server, so the plan must cover both the client count and the expected\n   message volume.`,
);

replaceOnce(
  'docs/POSTMARK_PROVISIONING.md',
  `   if you want the stream name in Postmark's UI to read as the deployment's rather than the generic\n   default.`,
  `   if you want the stream name in Postmark's UI to match the deployment name instead of the\n   generic default.`,
);

replaceOnce(
  'docs/POSTMARK_PROVISIONING.md',
  `check \`unknown\` rather than failing, so a missing key reads as "can't tell" in`,
  `check \`unknown\` rather than failing, so a missing key appears as "can't tell" in`,
);

replaceOnce(
  'docs/POSTMARK_PROVISIONING.md',
  `- [ ] \`node scripts/verify-sender-domain.cjs\` exits \`0\` for this deployment's sender domain\n      (\`eventrunner.org\` for the dev/demo deployment) — not just "unknown"; unknown means one of the\n      two keys above is missing or wrong, not that the domain is fine.`,
  `- [ ] \`node scripts/verify-sender-domain.cjs\` exits \`0\` for this deployment's sender domain\n      (\`eventrunner.org\` for the dev/demo deployment) and reports a pass. An \`unknown\` result means\n      one of the two keys above is missing or wrong. It does not mean that the domain is ready.`,
);

replaceOnce(
  'docs/POSTMARK_PROVISIONING.md',
  `      recipient) produces a \`sent_emails\` row with \`deliveryStatus\` patched — confirms the webhook\n      round-trip end to end, not just that it's registered.`,
  `      recipient) produces a \`sent_emails\` row with \`deliveryStatus\` patched. This confirms the\n      complete webhook round trip, including the Firestore update.`,
);

replaceOnce(
  'docs/POSTMARK_PROVISIONING.md',
  `   \`sent_emails\` row's \`deliveryStatus\` — this is the actual round-trip proof, not just "the webhook\n   is registered." Check via the Firebase console`,
  `   \`sent_emails\` row's \`deliveryStatus\`. This update proves the round trip. Webhook registration\n   alone is not sufficient. Check via the Firebase console`,
);

console.log('Applied connector review fixes.');
