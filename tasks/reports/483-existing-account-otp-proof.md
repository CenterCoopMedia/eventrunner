# PR #486 — existing-account OTP browser proof

## Scope

Comment: [4254137131](https://github.com/CenterCoopMedia/eventrunner/pull/486#discussion_r4254137131).

This test-only follow-up starts from `99caa0b3067a4416caa3a1d75b90a52627bc4038`. The backend builder owns the OTP production fix. This commit changes only `e2e/ticket-claim.spec.js` and this report.

## Browser journey

The existing claim deep-link test now creates a Firebase Auth emulator account with an explicit UID and `emailVerified: false` before sign-in. It checks that starting state, enters the real OTP captured by the console email provider, and asserts that the same UID now has `emailVerified: true`.

The test keeps its existing deep-link and explicit-claim checks. The order reference stays in the URL and form. Authentication sends no claim request and leaves the ticket unclaimed. Clicking “Claim ticket” sends exactly one claim request. The ticket is then assigned to the original UID, that account becomes approved, and the same account can save a session bookmark and see it under its schedule.

The test no longer calls `ensureUser`, so a helper cannot create a verified replacement and hide the account-state regression. The separate `otp-signin.spec.js` journey continues to cover new-account creation. The browser test count is unchanged.

## Checks and limits

- Strict ESLint for `e2e/ticket-claim.spec.js`: **passed with zero warnings**.
- Node syntax check: **passed**.
- Playwright discovery for `e2e/ticket-claim.spec.js`: **one Chromium test collected**.
- `git diff --check`: **passed**.

The browser journey was **not executed locally**. This container cannot run the required Chromium sandbox. The director will run it in hosted CI after integrating the production OTP and claim fixes. No browser pass is claimed by this commit. No sandbox setting, production source, generated output, or GitHub state was changed.
