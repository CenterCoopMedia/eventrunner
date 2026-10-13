# Epic #483 — Stripe operator documentation

## Changes

- Added `docs/operator/stripe-ticketing.md`: merchant/operator responsibilities, reviewed offer and full-event scope, isolated test/live deployments, actual environment/secret names, restricted-key capability review, runtime/deploy IAM separation, generated snapshot-webhook signing secrets, endpoint verification versus real delivery proof, exact catalog/support control labels, a support matrix, safe pause/rollback, credential rotation, and separate retention categories with required written durations/owners.
- The runbook distinguishes synthetic CI/browser evidence from a separately authorized, unrun real Stripe sandbox rehearsal. It does not claim merchant setup, live sales, legal retention approval, or a real payment/refund test has occurred.
- Updated the Admin Guide's Ticketing and registration-action sections, the web README, Roadmap, and Unreleased changelog. Links identify #483 and preserve embedded payment collection (#325) and limited-access pass entitlements (#326) as deferred scope.
- Added the runbook to the Pages source manifest at `stripe-ticketing/`.

Aligned against the director's ADR 0004, the implemented Stripe provider/checkout/reconciliation code, managed-secret workflow, and current UI labels. Provider credential/rotation instructions cite current official Stripe documentation. The key-permission table describes actual SDK operations and requires confirmation in the authorized sandbox; it does not claim that a restricted key has already been exercised.

## Verification and integration

- In-memory documentation-site rendering with an isolated source overlay combining this branch's documentation and the director's ADR/provider dependencies: **30 pages, runbook rendered, support anchor present, zero link/render errors**. No generated files were written.
- Copy-style check: **517 files checked; no blocked patterns**.
- Pages source manifest ESLint with `--max-warnings 0`: **passed**.
- `git diff --check`: **passed**.

The isolated UI branch does not contain the director's new ADR or Stripe server files. A direct branch-only Pages render therefore identifies those expected missing link targets. The source overlay verified the integrated references without copying dependencies into this commit or weakening validation.

No product code changed in this follow-up. Full application, rules, and live-provider tests were not repeated for documentation changes. The director must regenerate/check the Pages and demo outputs after integration. The epic's complete acceptance condition remains with integrated PR review, CI, and the separately authorized operator launch work.
