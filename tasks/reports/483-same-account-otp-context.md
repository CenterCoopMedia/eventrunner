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

The updater ignores a stale returned credential once Firebase already holds a signed-out state, another account, or a newer same-UID object. This protects the React update; it does not cancel an SDK exchange that is already in flight. The code does not set `emailVerified` itself. It preserves the returned Firebase value and returns the original credential to the caller.

The auth-state subscription, loading state, and admin probe logic are unchanged. The new object follows the existing probe lifecycle: old probes are cancelled, access remains unknown until both new probes answer, and only server read permissions determine admin status and tier. Different-UID sign-in still uses the existing listener.

## Regression evidence

The adjacent `AuthContext.test.jsx` renders the real provider and a consumer. Its SDK mock follows the inspected same-UID event behavior. Nine cases cover:

- Updated verification state without an auth-state event.
- Admin probes for the refreshed object, including an operator-to-staff result.
- Sign-out during the OTP HTTP request, before any SDK exchange.
- Account switch during the OTP HTTP request, before any SDK exchange.
- A stale returned credential after Firebase has already signed out.
- A stale returned credential after Firebase has already switched accounts.
- A newer SDK object for the same UID.
- Normal different-UID sign-in without duplicate probes.
- A returned user who is still unverified, without inventing verification.

The first two cases failed before the original context fix. The two HTTP ownership cases failed before the follow-up guard below. All nine pass after both fixes.

## HTTP ownership follow-up

The follow-up starts from `9fc2639dc1d8db239c2c83d2b898e6ed527e00f8`. It captures `auth.currentUser` before the OTP HTTP call. If that object has changed when the response arrives, it rejects with `OtpRequestError`, code `auth-changed`, before calling `signInWithCustomToken`. The message tells the user to request a new code. A client-side rejection uses status `0`; it does not misstate the successful HTTP response as a server error.

Both delayed-HTTP regressions use an SDK mock that would actually replace `auth.currentUser` and emit the UID-changing auth-state event if called. Before the guard, the old token overwrote the signed-out state or replacement account. After the guard, there are zero SDK calls and the newer auth state is retained.

The earlier delayed-credential tests are named precisely. They prove the React updater ignores a returned object after the SDK has already moved on. They do not prove cancellation of an SDK request. Once `signInWithCustomToken` has already started, Firebase can install its result at completion through the unchanged auth listener. That pre-existing SDK-commit boundary would require broader auth coordination to change. This bounded fix does not claim otherwise or introduce new global auth middleware.

## Final checks

- Focused Vitest: **57 tests passed across four files**: `AuthContext.test.jsx`, `Login.test.jsx`, `TicketClaim.test.jsx`, and `AdminApp.test.jsx`.
- Strict scoped ESLint for the provider and new test: **passed with zero warnings**.
- Copy style: **526 files checked; no blocked patterns**.
- `git diff --check`: **passed**.

The existing AdminApp tests emit jsdom's `window.scrollTo` not-implemented diagnostics while passing. This change neither adds a scroll call nor suppresses those diagnostics. The new context tests emit no test diagnostics.

No production Firebase account was used. No browser execution, generated output, root-worktree edit, or GitHub mutation was made. The director owns integration, whole-suite checks, regeneration, and hosted browser verification.
