# PR #486 — same-account OTP context refresh

## Finding confirmed in the installed SDK

This follow-up covers the already-signed-in case of [comment 4254137131](https://github.com/CenterCoopMedia/eventrunner/pull/486#discussion_r4254137131). It starts from `2952db2fc31b65cda55b313c853d86215d3dee58`.

The installed primary implementation is `@firebase/auth` **1.13.4**, in `node_modules/@firebase/auth/dist/node-esm/totp-C7PFgVcO.js`:

- `UserImpl._fromIdTokenResponse`, at lines 1913–1923, constructs a new user instance and reloads its account data.
- `signInWithCustomToken`, at lines 5827–5838, installs the returned credential's user as the current user.
- `notifyAuthListeners`, at lines 3057–3066, emits an auth-state event only when the UID changes. It suppresses that event for a replacement object with the same UID.

`AuthContext` subscribes to `onAuthStateChanged`. A signed-in, unverified attendee can therefore complete OTP, get a verified Firebase user object, and retain the old unverified object in React context.

## Bounded fix

`AuthContext.jsx` now awaits the successful custom-token credential and refreshes the context's user object when both conditions hold inside the state updater:

1. The context still holds that UID.
2. Firebase still holds that exact returned user object.

A completed sign-out, account switch, or newer same-UID credential wins over the old result. The code does not set `emailVerified` itself. It preserves the returned Firebase value and returns the original credential to the caller.

The auth-state subscription, loading state, and admin probe logic are unchanged. The new object follows the existing probe lifecycle: old probes are cancelled, access remains unknown until both new probes answer, and only server read permissions determine admin status and tier. Different-UID sign-in still uses the existing listener.

## Regression evidence

The new adjacent `AuthContext.test.jsx` renders the real provider and a consumer. Its SDK mock follows the inspected same-UID event behavior. Seven cases cover:

- Updated verification state without an auth-state event.
- Admin probes for the refreshed object, including an operator-to-staff result.
- Sign-out before a pending credential returns.
- Account switch before an older credential returns.
- A newer SDK object for the same UID.
- Normal different-UID sign-in without duplicate probes.
- A returned user who is still unverified, without inventing verification.

The first two cases failed before the production fix. All seven pass after it.

## Final checks

- Focused Vitest: **55 tests passed across four files**: `AuthContext.test.jsx`, `Login.test.jsx`, `TicketClaim.test.jsx`, and `AdminApp.test.jsx`.
- Strict scoped ESLint for the provider and new test: **passed with zero warnings**.
- Copy style: **526 files checked; no blocked patterns**.
- `git diff --check`: **passed**.

The existing AdminApp tests emit jsdom's `window.scrollTo` not-implemented diagnostics while passing. This change neither adds a scroll call nor suppresses those diagnostics. The new context tests emit no test diagnostics.

No production Firebase account was used. No browser execution, generated output, root-worktree edit, or GitHub mutation was made. The director owns integration, whole-suite checks, regeneration, and hosted browser verification.
