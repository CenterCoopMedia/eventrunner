# OTP email verification after ticket account creation

## Review finding

PR #486 connector comment 4254137131 reports that an existing Auth account
with an unverified email can complete the emailed-code flow without becoming
verified. Ticket account creation can produce this state. The later claim
gate then asks the attendee to verify the same address again.

## Change

`functions/src/auth/otp.cjs` now waits for the existing account's email
verification update before it creates a custom sign-in token. The update
sets the email from the successful stored challenge and `emailVerified` in
one Auth write. It preserves the existing UID. An already verified account
needs no update. New accounts retain the existing verified creation flow.

The handler checks that the Auth record and update result match the proven
email and original UID. The update sits outside the lookup's user-not-found
catch. A deleted account or failed update cannot trigger replacement account
creation. Auth failures return the existing generic 500 response, mint no
token, and release the consumed challenge so the attendee can retry.

## Evidence

`functions/src/auth/otp.test.cjs` adds seven regressions. They cover a
precreated unverified attendee account, update-before-token ordering,
concurrent replay, verified-account reuse, wrong code/email rejection,
identity mismatch, update failure and retry, and token failure after a
successful verification write. Existing round-trip tests also check the
verified state for new and reused accounts.

The new behavioral regressions failed before the source fix. The final
checks used Node 22:

- OTP and challenge suites: 58 passed, zero failures or skips.
- Full Node suite under the shared heavy-command lock: 3,075 passed,
  zero failures or skips.
- Strict ESLint for the two changed source/test files: passed.
- `git diff --check`: passed.

The finding is addressed at the real OTP handler boundary with synthetic
Auth and Firestore dependencies. No live Firebase account or browser flow
was exercised. This commit changes no UI, shared package, generated output,
or public error contract. The director owns stack integration and GitHub
review resolution.
